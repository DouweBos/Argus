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

  public private(set) var hosts: [DeviceIdentity] = []
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

  @ObservationIgnored private let file: PairedHostsFile
  @ObservationIgnored private let clientInfo: PairingClientInfo
  @ObservationIgnored private var router: HostRouter?
  @ObservationIgnored private var pairingClient: PairingClient?
  @ObservationIgnored private var retries: [HostId: Task<Void, Never>] = [:]

  public init(file: PairedHostsFile, clientInfo: PairingClientInfo) {
    self.file = file
    self.clientInfo = clientInfo
    let contents = file.load()
    hosts = contents.hosts
    attached = Set(contents.attached.filter { id in contents.hosts.contains { $0.deviceId == id } })
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
    for id in attached { connect(id) }
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
      if previous != .ready { onReady(hostId) }
    case .offline:
      states[hostId] = .offline
    case .connecting, .handshaking:
      if previous != .ready { states[hostId] = .connecting }
    }
  }

  private func connect(_ hostId: HostId) {
    guard let identity = identity(hostId), let router else { return }
    states[hostId] = .connecting
    retries[hostId]?.cancel()
    retries[hostId] = Task { [weak self] in
      var delay: Duration = .seconds(5)
      while !Task.isCancelled {
        if let (link, url) = try? await RemoteHostLink.connect(identity: identity) {
          guard let self, self.attached.contains(hostId), !Task.isCancelled else {
            await link.disconnect()
            return
          }
          await router.add(link, label: identity.label)
          self.remember(url: url, for: hostId)
          self.linkState(hostId, .ready)
          self.onHostsChanged()
          return
        }
        guard let self, self.attached.contains(hostId) else { return }
        self.states[hostId] = .unreachable
        try? await Task.sleep(for: delay)
        delay = min(delay * 2, .seconds(60))
      }
    }
  }

  private func remember(url: String, for hostId: HostId) {
    guard let index = hosts.firstIndex(where: { $0.deviceId == hostId }) else { return }
    hosts[index].url = url
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
    hosts.removeAll { $0.deviceId == hostId }
    states[hostId] = nil
    persist()
    onHostsChanged()
    onAction(.forget, true)
  }

  public func rename(_ hostId: HostId, to label: String) {
    let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let index = hosts.firstIndex(where: { $0.deviceId == hostId }) else {
      return
    }
    hosts[index].hostName = trimmed
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
    try? file.save(.init(hosts: hosts, attached: hosts.map(\.deviceId).filter(attached.contains)))
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
    hosts.removeAll { $0.deviceId == identity.deviceId || $0.desktopPubB64 == identity.desktopPubB64 }
    hosts.append(identity)
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
