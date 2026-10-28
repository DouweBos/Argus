import Foundation

/// When to look for a better route than the one a live connection is on.
///
/// Connecting races every address once; after that the phone moves — home onto
/// Wi-Fi, onto the tailnet — and the best route changes under a connection
/// that still works. This decides when preflighting the better-ranked addresses
/// is worth it, and keeps a flaky network from bouncing the connection between
/// routes. Pure: the caller supplies the clock and does the dialling.
public struct RouteUpgradePolicy: Sendable {
  public enum Trigger: Sendable, Equatable {
    /// The device's network path changed, or the app came back to the foreground.
    case pathChanged
    /// The periodic re-check.
    case timer
  }

  public enum Plan: Sendable, Equatable {
    case none
    /// Preflight these, best first, without touching the live connection.
    case upgrade([RemoteEndpoint])
    /// The connection is down: race every candidate, not just the dead address.
    case rerace([RemoteEndpoint])
  }

  public var recheckInterval: TimeInterval = 120
  /// The first back-off after a failed preflight; doubles per failure.
  public var cooldown: TimeInterval = 60
  public var maxCooldown: TimeInterval = 16 * 60
  /// A route switched to that drops within this long counts as flaky.
  public var stabilityWindow: TimeInterval = 120

  /// The route the live connection is on; nil before the first connect.
  public private(set) var current: RemoteEndpoint?
  public private(set) var isUp = false
  private var upgradedAt: Date?
  private var lastCheck: Date?
  private var strikes: [String: Strike] = [:]

  private struct Strike: Sendable {
    var count: Int
    var until: Date
    /// Survives a path change: the route worked, then dropped.
    var sticky: Bool
  }

  public init() {}

  /// A connection came up over `endpoint`; `upgraded` when it replaced a live one.
  public mutating func connected(via endpoint: RemoteEndpoint, upgraded: Bool = false, now: Date) {
    current = endpoint
    isUp = true
    upgradedAt = upgraded ? now : nil
    lastCheck = now
    if strikes[endpoint.url]?.sticky != true { strikes[endpoint.url] = nil }
  }

  /// The live connection dropped. A route switched to only moments ago is held
  /// against it, so the next check doesn't switch straight back.
  public mutating func connectionLost(now: Date) {
    guard isUp else { return }
    isUp = false
    if let current, let upgradedAt, now.timeIntervalSince(upgradedAt) < stabilityWindow {
      strike(current.url, sticky: true, now: now)
    }
    upgradedAt = nil
  }

  /// The owner dropped the connection itself (a fresh connect, another computer).
  public mutating func disconnected() {
    isUp = false
    upgradedAt = nil
  }

  /// The transport reconnected on its own, over the same route.
  public mutating func connectionRestored() {
    isUp = current != nil
  }

  /// A different network is fresh evidence: addresses that failed on the old
  /// one get another chance. Routes that dropped after a switch stay held.
  public mutating func pathChanged() {
    strikes = strikes.filter { $0.value.sticky }
  }

  public func plan(candidates: [RemoteEndpoint], trigger: Trigger, now: Date) -> Plan {
    if trigger == .timer, let lastCheck, now.timeIntervalSince(lastCheck) < recheckInterval { return .none }
    let usable = candidates.filter { !coolingDown($0.url, now: now) }
    guard isUp else {
      // Down is worse than flaky: with every address held back, try them all.
      if candidates.isEmpty { return .none }
      return .rerace(usable.isEmpty ? candidates : usable)
    }
    guard let current else { return .none }
    let better = usable.filter { $0.priority < current.priority && $0.url != current.url }
    return better.isEmpty ? .none : .upgrade(better)
  }

  /// A preflight or re-race finished. Every candidate ranked above the winner
  /// (all of them, without one) failed and backs off, longer each time.
  public mutating func checked(_ candidates: [RemoteEndpoint], winner: RemoteEndpoint?, now: Date) {
    lastCheck = now
    let bar = winner?.priority ?? Int.max
    for candidate in candidates where candidate.priority < bar {
      strike(candidate.url, sticky: strikes[candidate.url]?.sticky ?? false, now: now)
    }
  }

  public func coolingDown(_ url: String, now: Date) -> Bool {
    (strikes[url]?.until ?? .distantPast) > now
  }

  private mutating func strike(_ url: String, sticky: Bool, now: Date) {
    let count = (strikes[url]?.count ?? 0) + 1
    let wait = min(cooldown * pow(2, Double(count - 1)), maxCooldown)
    strikes[url] = Strike(count: count, until: now.addingTimeInterval(wait), sticky: sticky)
  }
}
