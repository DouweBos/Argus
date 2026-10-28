import ArgusKit
import Foundation
import Observation

/// The hosts this Mac drives besides its own: pairing, attaching, the link
/// state of each, and which one unscoped screens read from. The desktop's
/// Hosts settings plus its connection registry.
@MainActor
@Observable
public final class RemoteHostsStore {
  public enum LinkState: Equatable, Sendable {
    case detached
    case connecting
    case ready
    /// Attached but its connection dropped; it reconnects on its own.
    case offline
    /// Attached but no known address answered; retried in the background.
    case unreachable
  }

  public enum Pairing: Equatable, Sendable {
    case idle
    case connecting
    /// Compare this code with the host's, then approve it there.
    case confirm(sas: String)
    case paired(label: String, admin: Bool)
    case failed(String)
  }

  public enum Action: String, Sendable {
    case pair, attach, detach, forget, rename, focus
  }

  /// QR-paired hosts, kept in the file.
  public private(set) var pairedHosts: [DeviceIdentity] = []
  /// Hosts on the signed-in account, rebuilt from its verified log.
  public private(set) var accountHosts: [DeviceIdentity] = []
  /// Every host this Mac can drive: paired ∪ account, one row per computer.
  public var hosts: [DeviceIdentity] { .merging(paired: pairedHosts, account: accountHosts) }
  public private(set) var attached: Set<HostId> = []
  public private(set) var states: [HostId: LinkState] = [:]
  public private(set) var pairing: Pairing = .idle
  /// The host unscoped screens (settings, automations, devices) read from.
  public private(set) var focused: HostId = Hosts.local

  /// A host came (back) up and its share of the window should be refetched.
  @ObservationIgnored public var onReady: (HostId) -> Void = { _ in }
  /// A host's lists went or came, so the merged lists should be refetched.
  @ObservationIgnored public var onHostsChanged: () -> Void = {}
  @ObservationIgnored public var onAction: (Action, Bool) -> Void = { _, _ in }
  /// An attached account host can't be reached: poll the directory for a moved address.
  @ObservationIgnored public var onAccountHostFailing: (Bool) -> Void = { _ in }
  /// A live link moved to a better-ranked route.
  @ObservationIgnored public var onRouteUpgraded: (_ from: RemoteEndpoint.Kind, _ to: RemoteEndpoint.Kind) -> Void = { _, _ in }

  @ObservationIgnored private let file: PairedHostsFile
  @ObservationIgnored private let clientInfo: PairingClientInfo
  @ObservationIgnored private var router: HostRouter?
  @ObservationIgnored private var pairingClient: PairingClient?
  @ObservationIgnored private var retries: [HostId: Task<Void, Never>] = [:]
  /// Each attached host's route watcher; see `RouteSupervisor`.
  @ObservationIgnored private var routes: [HostId: RouteSupervisor] = [:]

  public init(file: PairedHostsFile, clientInfo: PairingClientInfo) {
    self.file = file
    self.clientInfo = clientInfo
    let contents = file.load()
    pairedHosts = contents.hosts
    // Account hosts arrive later, from the account log; keep theirs too.
    attached = Set(contents.attached.filter { id in
      id.hasPrefix(Self.accountPrefix) || contents.hosts.contains { $0.deviceId == id }
    })
  }

  public func label(_ hostId: HostId) -> String {
    hostId == Hosts.local ? "This Mac" : identity(hostId)?.label ?? "Unknown host"
  }

  public func identity(_ hostId: HostId) -> DeviceIdentity? {
    hosts.first { $0.deviceId == hostId }
  }

  public func state(_ hostId: HostId) -> LinkState {
    hostId == Hosts.local ? .ready : states[hostId] ?? .detached
  }

  /// Attached hosts in pairing order, this Mac first.
  public var machines: [HostId] {
    [Hosts.local] + hosts.map(\.deviceId).filter(attached.contains)
  }

  // MARK: Lifecycle

  /// Start routing through `router` and re-attach last launch's hosts. None of
  /// them blocks the window or each other.
  public func bind(_ router: HostRouter) {
    self.router = router
    for id in attached where identity(id) != nil { connect(id) }
  }

  static let accountPrefix = "account:"

  /// The account's hosts changed: new ones listed, moved ones redialled now
  /// rather than at the end of their back-off.
  public func setAccountHosts(_ identities: [DeviceIdentity]) {
    let previous = Dictionary(accountHosts.map { ($0.deviceId, $0) }, uniquingKeysWith: { a, _ in a })
    accountHosts = identities
    for identity in identities where attached.contains(identity.deviceId) {
      let moved = previous[identity.deviceId]?.endpoints != identity.endpoints
      if previous[identity.deviceId] == nil || (moved && state(identity.deviceId) != .ready) {
        connect(identity.deviceId)
      }
    }
    for gone in previous.keys where !identities.contains(where: { $0.deviceId == gone }) {
      if attached.contains(gone) { Task { await detach(gone) } }
    }
    onHostsChanged()
  }

  /// A paired host's connection changed (called from the router's thread).
  public nonisolated func linkEvent(_ hostId: HostId, _ event: RemoteHostLink.Event) {
    guard case .state(let state) = event else { return }
    Task { @MainActor in self.linkState(hostId, state) }
  }

  private func linkState(_ hostId: HostId, _ state: Transport.State) {
    guard attached.contains(hostId) else { return }
    let previous = states[hostId]
    switch state {
    case .ready:
      states[hostId] = .ready
      routes[hostId]?.connectionChanged(up: true)
      if previous != .ready { onReady(hostId) }
    case .offline:
      states[hostId] = .offline
      routes[hostId]?.connectionChanged(up: false)
    case .connecting, .handshaking:
      if previous != .ready { states[hostId] = .connecting }
    }
  }

  private func connect(_ hostId: HostId) {
    guard identity(hostId) != nil, let router else { return }
    states[hostId] = .connecting
    retries[hostId]?.cancel()
    supervisor(hostId).suspend()
    retries[hostId] = Task { [weak self] in
      var delay: Duration = .seconds(5)
      while !Task.isCancelled {
        // Re-read each try: an account host's addresses move with its presence.
        guard let identity = self?.identity(hostId) else { return }
        if let (link, url) = try? await RemoteHostLink.connect(identity: identity) {
          guard let self, self.attached.contains(hostId), !Task.isCancelled else {
            await link.disconnect()
            return
          }
          await router.add(link, label: identity.label)
          self.remember(url: url, for: hostId)
          self.routes[hostId]?.connected(via: link.endpoint)
          self.linkState(hostId, .ready)
          self.reportAccountFailures()
          self.onHostsChanged()
          return
        }
        guard let self, self.attached.contains(hostId) else { return }
        self.states[hostId] = .unreachable
        self.reportAccountFailures()
        try? await Task.sleep(for: delay)
        delay = min(delay * 2, .seconds(60))
      }
    }
  }

  private func supervisor(_ hostId: HostId) -> RouteSupervisor {
    if let existing = routes[hostId] { return existing }
    let supervisor = RouteSupervisor(
      hooks: .init(
        identity: { [weak self] in
          guard let self, self.router?.link(hostId) != nil else { return nil }
          return self.identity(hostId)
        },
        busy: { [weak self] in self?.router?.link(hostId)?.isStreaming ?? false },
        adopt: { [weak self] attempt, upgrade in
          await self?.adopt(attempt, for: hostId, upgrade: upgrade) ?? false
        },
        networkChanged: { [weak self] in
          // An unreachable host waits out up to a minute of back-off; a new network is worth trying now.
          guard let self, self.attached.contains(hostId), self.states[hostId] == .unreachable else { return }
          self.connect(hostId)
        }))
    routes[hostId] = supervisor
    return supervisor
  }

  /// Swap a host's link for one on a better route: the router adopts the new
  /// link before it closes the old one, and the host's lists are refetched for
  /// whatever arrived in between.
  private func adopt(_ attempt: EndpointRacer.Attempt, for hostId: HostId, upgrade: Bool) async -> Bool {
    guard attached.contains(hostId), let router, let current = router.link(hostId),
      let identity = identity(hostId)
    else { return false }
    await router.add(current.replaced(by: attempt), label: identity.label, drain: .seconds(10))
    remember(url: attempt.url, for: hostId)
    if upgrade { onRouteUpgraded(current.endpoint.kind, attempt.endpoint.kind) }
    states[hostId] = .ready
    onReady(hostId)
    reportAccountFailures()
    return true
  }

  private func reportAccountFailures() {
    onAccountHostFailing(
      attached.contains { $0.hasPrefix(Self.accountPrefix) && states[$0] == .unreachable })
  }

  private func remember(url: String, for hostId: HostId) {
    if let index = accountHosts.firstIndex(where: { $0.deviceId == hostId }) {
      accountHosts[index].url = url
      return
    }
    guard let index = pairedHosts.firstIndex(where: { $0.deviceId == hostId }) else { return }
    pairedHosts[index].url = url
    persist()
  }

  // MARK: Actions

  public func attach(_ hostId: HostId) {
    guard identity(hostId) != nil else { return }
    attached.insert(hostId)
    persist()
    connect(hostId)
    onAction(.attach, true)
  }

  /// Stop driving a host. Its projects leave the sidebar; a view still open
  /// on one of its sessions fails loudly rather than reaching this Mac.
  public func detach(_ hostId: HostId) async {
    attached.remove(hostId)
    retries.removeValue(forKey: hostId)?.cancel()
    routes.removeValue(forKey: hostId)?.stop()
    states[hostId] = .detached
    if focused == hostId { focus(Hosts.local) }
    persist()
    await router?.remove(hostId)
    router?.dropCache(hostId)
    onHostsChanged()
    onAction(.detach, true)
  }

  /// Unpair: detach and delete this Mac's key for it. Revoking it on the host
  /// is the host's to do.
  public func forget(_ hostId: HostId) async {
    await detach(hostId)
    await router?.forget(hostId)
    pairedHosts.removeAll { $0.deviceId == hostId }
    states[hostId] = nil
    persist()
    onHostsChanged()
    onAction(.forget, true)
  }

  public func rename(_ hostId: HostId, to label: String) {
    let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let index = pairedHosts.firstIndex(where: { $0.deviceId == hostId }) else {
      return
    }
    pairedHosts[index].hostName = trimmed
    router?.setLabel(trimmed, for: hostId)
    persist()
    onAction(.rename, true)
  }

  public func focus(_ hostId: HostId) {
    guard hostId == Hosts.local || attached.contains(hostId) else { return }
    focused = hostId
    router?.focusedHost = hostId
    onAction(.focus, true)
  }

  private func persist() {
    let listed = hosts.map(\.deviceId).filter(attached.contains)
    // An attached account host not listed yet (the log loads after launch) stays attached.
    let pending = attached.subtracting(listed).sorted()
    try? file.save(.init(hosts: pairedHosts, attached: listed + pending))
  }

  // MARK: Pairing

  /// Pair against a code from the other machine's Remote access screen.
  public func startPairing(code: String) {
    let payload: PairingPayload
    do {
      payload = try PairingClient.parse(code)
    } catch {
      pairing = .failed("That doesn't look like a valid pairing code.")
      onAction(.pair, false)
      return
    }
    pairing = .connecting
    let client = PairingClient(payload: payload, client: clientInfo)
    pairingClient = client
    Task { [weak self] in
      for await event in await client.start() {
        guard let self else { return }
        switch event {
        case .sas(let sas): self.pairing = .confirm(sas: sas)
        case .paired(let identity): self.paired(identity)
        case .failed(let error): self.pairingFailed(error)
        }
      }
    }
  }

  public func cancelPairing() {
    let client = pairingClient
    pairingClient = nil
    pairing = .idle
    Task { await client?.cancel() }
  }

  public func clearPairing() {
    if case .confirm = pairing { return }
    pairing = .idle
  }

  private func paired(_ identity: DeviceIdentity) {
    pairingClient = nil
    // Re-pairing the same machine replaces its stale key.
    pairedHosts.removeAll { $0.deviceId == identity.deviceId || $0.desktopPubB64 == identity.desktopPubB64 }
    pairedHosts.append(identity)
    let admin = identity.capabilities.contains("admin")
    pairing = .paired(label: identity.label, admin: admin)
    persist()
    onAction(.pair, true)
    if admin { attach(identity.deviceId) }
  }

  private func pairingFailed(_ error: PairingError) {
    pairingClient = nil
    let message =
      switch error {
      case .invalidCode: "That doesn't look like a valid pairing code."
      case .handshakeFailed: "The code didn't match, or the host isn't the one that showed it."
      case .unreadableGrant: "The host's answer couldn't be read."
      case .cancelled: "Pairing was cancelled."
      }
    pairing = .failed(message)
    onAction(.pair, false)
  }
}
