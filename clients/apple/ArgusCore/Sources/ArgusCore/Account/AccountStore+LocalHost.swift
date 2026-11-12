import ArgusKit
import Foundation

/// The Mac's bundled host on the account with no code (§5.2b).
extension AccountStore {
  /// How putting this Mac's host on the account went, where its own host can't count it.
  public enum LocalHostOutcome: String, Sendable {
    /// Already on this account (this Mac had forgotten it): taken as linked.
    case adopted
    /// On another account: the Move action is offered.
    case conflict
    /// Taken off the other account and put on this one.
    case moved
    case failed
  }

  /// Which account the bundled host is linked to, nil when it isn't.
  public struct LocalHostLink: Equatable, Sendable {
    public var accountId: String
    public var epoch: Int
    public var hostId: String

    public init(accountId: String, epoch: Int, hostId: String) {
      self.accountId = accountId
      self.epoch = epoch
      self.hostId = hostId
    }
  }

  /// Runs after genesis, sign-in and on each launch until it sticks.
  func linkLocalHostIfNeeded() async {
    guard let localHost, phase == .ready, let root = state?.root else { return }
    if localHostLinked { return }
    localLinkError = nil
    localLinkConflict = false
    do {
      if let linked = try await localHost.status() {
        await settleLinked(linked, root: root)
      } else {
        try await addLocalHost(localHost)
      }
    } catch let error as Transport.TransportError where error.isTransient {
      // Retried when the connection to the host comes up.
      localLinkError = "Waiting for this Mac's host to start."
    } catch {
      localLinkError = Self.describe(error)
      onEvent(.localHost(outcome: .failed))
    }
  }

  /// The host is already linked: adopt it when that's this account, else offer the move.
  private func settleLinked(_ linked: LocalHostLink, root: AccountRoot) async {
    guard linked.accountId == root.accountId, linked.epoch == root.epoch else {
      localLinkConflict = true
      localLinkError =
        linked.accountId == root.accountId
        ? "This Mac's host is still on your account from before it was reset."
        : "This Mac's host is on another Argus account."
      onEvent(.localHost(outcome: .conflict))
      return
    }
    // The host says it's live here: this log may just be behind.
    if state?.liveMember(linked.hostId) == nil { await refreshLog() }
    guard state?.liveMember(linked.hostId)?.member.role == .host else {
      localLinkConflict = true
      localLinkError = "This Mac's host was taken off your account."
      onEvent(.localHost(outcome: .conflict))
      return
    }
    vault.localHostId = linked.hostId
    await vaultStore.save(vault)
    publishHosts()
    onEvent(.localHost(outcome: .adopted))
  }

  private func addLocalHost(_ localHost: any AccountLocalHostLinking) async throws {
    var offer = try await localHost.begin()
    guard offer.host.role == .host else { throw AccountStoreError.keys }
    // One name for this Mac and its host; the proof doesn't cover it.
    offer.host.name = AccountDeviceKeys.memberName(deviceName())
    if state?.liveMember(offer.host.id) == nil {
      try await appendWithRetry { [self] head in
        [
          try entry(
            head: head, .addHost(member: offer.host, requestId: "", sasCommit: "", proof: offer.proof))
        ]
      }
    }
    guard let root = state?.root else { return }
    try await localHost.finish(root: root)
    vault.localHostId = offer.host.id
    await vaultStore.save(vault)
    publishHosts()
  }

  /// Retry the bundled host's link from the Account screen.
  public func linkLocalHost() async {
    await linkLocalHostIfNeeded()
  }

  /// The host is on another account (or one it was taken off): it signs itself
  /// off that one and joins this one. Only ever on the user's say-so.
  public func moveLocalHost() async {
    guard let localHost, localLinkConflict else { return }
    do {
      try await localHost.unlink()
    } catch {
      localLinkError = Self.describe(error)
      onEvent(.localHost(outcome: .failed))
      return
    }
    await linkLocalHostIfNeeded()
    if localHostLinked { onEvent(.localHost(outcome: .moved)) }
  }

  public var localHostLinked: Bool {
    vault.localHostId.flatMap { state?.liveMember($0) } != nil
  }
}
