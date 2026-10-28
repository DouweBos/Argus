import ArgusKit
import Foundation

/// Keeps one computer's connection on the best route that works.
///
/// Watches the network path and a slow timer, asks `RouteUpgradePolicy`
/// whether a check is due, preflights the better addresses with
/// `EndpointRacer` and hands a winner to its owner to swap in. The live
/// connection is never touched until the new one has completed its handshake.
/// While the connection is down, a network change re-races every address
/// instead of waiting on the dead one.
@MainActor
public final class RouteSupervisor {
  public struct Hooks {
    /// The computer as currently known, with every address to try. Nil while
    /// there's nothing to supervise.
    public var identity: @MainActor () -> DeviceIdentity?
    /// Something bound to this connection would break on a switch.
    public var busy: @MainActor () -> Bool
    /// Adopt a connection that won a preflight; `upgrade` when a live one is
    /// being replaced. False when it's no longer wanted, and it gets closed.
    public var adopt: @MainActor (_ attempt: EndpointRacer.Attempt, _ upgrade: Bool) async -> Bool
    /// The network moved; for owners with their own retry loop to cut short.
    public var networkChanged: @MainActor () -> Void

    public init(
      identity: @escaping @MainActor () -> DeviceIdentity?,
      busy: @escaping @MainActor () -> Bool = { false },
      adopt: @escaping @MainActor (EndpointRacer.Attempt, Bool) async -> Bool,
      networkChanged: @escaping @MainActor () -> Void = {}
    ) {
      self.identity = identity
      self.busy = busy
      self.adopt = adopt
      self.networkChanged = networkChanged
    }
  }

  static let tick: Duration = .seconds(30)
  /// Joining Wi-Fi reports several paths in a row; dial once it settles.
  static let settle: Duration = .seconds(2)

  private var policy = RouteUpgradePolicy()
  private let hooks: Hooks
  private let paths = NetworkPathWatcher()
  private var ticker: Task<Void, Never>?
  private var pendingPath: Task<Void, Never>?
  private var checking = false
  /// The owner is connecting from scratch (its own race decides) or has let go.
  private var connecting = false
  /// Bumped on every connect, so a check that outlives its connection is dropped.
  private var epoch = 0

  public init(hooks: Hooks) {
    self.hooks = hooks
    paths.start { [weak self] in
      Task { @MainActor in self?.pathChanged() }
    }
    ticker = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: Self.tick)
        await self?.evaluate(.timer)
      }
    }
  }

  /// Stop watching; the owner is done with this computer.
  public func stop() {
    paths.stop()
    ticker?.cancel()
    pendingPath?.cancel()
    epoch += 1
  }

  /// The route the connection is on, as of the last connect or switch.
  public var route: RemoteEndpoint? { policy.current }

  /// The owner is connecting from scratch, or has let the connection go:
  /// checks wait for the next `connected(via:)`.
  public func suspend() {
    epoch += 1
    connecting = true
    policy.disconnected()
  }

  /// A connect finished: over `endpoint`, or nowhere.
  public func connected(via endpoint: RemoteEndpoint?) {
    connecting = false
    if let endpoint { policy.connected(via: endpoint, now: Date()) }
  }

  /// The connection went up or down on its own.
  public func connectionChanged(up: Bool) {
    if up { policy.connectionRestored() } else { policy.connectionLost(now: Date()) }
  }

  /// The app came back to the foreground: as good as a new network.
  public func recheck() {
    pathChanged()
  }

  private func pathChanged() {
    policy.pathChanged()
    hooks.networkChanged()
    pendingPath?.cancel()
    pendingPath = Task { [weak self] in
      try? await Task.sleep(for: Self.settle)
      guard !Task.isCancelled else { return }
      await self?.evaluate(.pathChanged)
    }
  }

  private func evaluate(_ trigger: RouteUpgradePolicy.Trigger) async {
    guard !checking, !connecting, let identity = hooks.identity() else { return }
    let upgrade: Bool
    let candidates: [RemoteEndpoint]
    switch policy.plan(candidates: identity.candidateEndpoints, trigger: trigger, now: Date()) {
    case .none: return
    case .upgrade(let better):
      // Retried on the next tick rather than cutting a stream off.
      if hooks.busy() { return }
      (upgrade, candidates) = (true, better)
    case .rerace(let all):
      (upgrade, candidates) = (false, all)
    }

    checking = true
    defer { checking = false }
    let started = epoch
    let attempt = await EndpointRacer.preflight(identity: identity, candidates: candidates)
    guard started == epoch else {
      await attempt?.transport.disconnect()
      return
    }
    policy.checked(candidates, winner: attempt?.endpoint, now: Date())
    guard let attempt else { return }
    let adopted = worthAdopting(attempt.endpoint, upgrade: upgrade) ? await hooks.adopt(attempt, upgrade) : false
    guard adopted else {
      await attempt.transport.disconnect()
      return
    }
    policy.connected(via: attempt.endpoint, upgraded: upgrade, now: Date())
  }

  /// The world moves during a race: a stream may have started, or the old
  /// connection come back on its own over a route as good as the winner.
  private func worthAdopting(_ winner: RemoteEndpoint, upgrade: Bool) -> Bool {
    if upgrade { return !hooks.busy() }
    guard policy.isUp, let current = policy.current else { return true }
    return winner.priority < current.priority
  }
}
