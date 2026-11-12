import ArgusKit
import Foundation

extension AccountStore {
  // MARK: Log

  /// Fetch and verify entries past the head. A log that doesn't verify is
  /// refused whole and the last good state stays.
  func refreshLog() async {
    guard let current = state, let root = vault.root else { return }
    let fresh: [AccountEntry]
    do {
      fresh = try await client.log(epoch: current.epoch, after: current.head.seq)
    } catch {
      return
    }
    guard !fresh.isEmpty else { return }
    switch AccountLog.verify(fresh, root: root, prior: current) {
    case .ok(let verified):
      logError = nil
      await adopt(verified, appending: fresh)
    case .rejected(let reason, _, _):
      logError = reason
    }
  }

  private func adopt(_ verified: AccountLogState, appending entries: [AccountEntry]) async {
    let prior = state
    state = verified
    vault.entries += entries
    guard ownMemberLive(in: verified) else {
      // Another device removed this one.
      error = "This device was removed from your account."
      await forgetAccount()
      return
    }
    if let prior { reflectName(from: prior, to: verified) }
    await vaultStore.save(vault)
    publishHosts()
  }

  /// Sign entries against the current head and append them; when another
  /// device moved the head first, catch up and sign again, once.
  func appendWithRetry(apply: Bool = true, _ build: (AccountHead) throws -> [AccountEntry]) async throws {
    for attempt in 0..<2 {
      guard let current = state else { throw AccountStoreError.notReady }
      let entries = try build(current.head)
      do {
        try await client.append(epoch: current.epoch, entries: entries)
      } catch AccountServiceError.conflict where attempt == 0 {
        await refreshLog()
        continue
      }
      if apply { try await applyOwn(entries) }
      return
    }
    throw AccountStoreError.headMoved
  }

  /// Entries this device just appended, folded into the verified state.
  func applyOwn(_ entries: [AccountEntry]) async throws {
    guard let current = state,
      case .ok(let verified) = AccountLog.verify(entries, root: vault.root, prior: current)
    else { throw AccountStoreError.untrustedLog }
    await adopt(verified, appending: entries)
    if phase == .ready { onLogAppended() }
  }

  func entry(head: AccountHead, _ fields: AccountEntryBuilder.Fields) throws -> AccountEntry {
    guard let current = state, let signer = vault.keys?.signer else { throw AccountStoreError.notReady }
    return try AccountEntryBuilder.make(
      accountId: current.accountId, epoch: current.epoch, head: head, ts: nowMs(), signer: signer, fields)
  }

  // MARK: Directory

  /// Verified presence for every live host; a record older than the one held is dropped.
  /// Online is recomputed against now even when the fetch fails, so a host
  /// that went quiet stops showing as online.
  public func refreshDirectory() async {
    guard phase == .ready, !galleryFrozen, let current = state else { return }
    guard let records = try? await client.directory() else {
      publishHosts()
      return
    }
    var changed = false
    for record in records {
      guard let presence = AccountLog.verifyPresence(record, state: current) else { continue }
      if let held = vault.presence[record.hostId], held.ts > presence.ts { continue }
      let cached = AccountCachedPresence(ts: presence.ts, lastSeen: record.lastSeen, endpoints: presence.endpoints)
      if vault.presence[record.hostId] != cached {
        vault.presence[record.hostId] = cached
        changed = true
      }
    }
    if changed { await vaultStore.save(vault) }
    publishHosts()
  }

  func publishHosts() {
    let members = state?.liveMembers.filter { $0.role == .host } ?? []
    let next = members.map { member in
      let presence = vault.presence[member.id]
      return Host(
        member: member, endpoints: presence?.endpoints ?? [], lastSeen: presence?.lastSeen,
        online: AccountPresence.isOnline(lastSeenMs: presence?.lastSeen, now: now()),
        isLocal: member.id == vault.localHostId)
    }
    let previousMembers = hosts.map(\.member)
    let identitiesChanged = next.map(\.member) != hosts.map(\.member) || next.map(\.endpoints) != hosts.map(\.endpoints)
    if next != hosts { hosts = next }
    if identitiesChanged { onHostsChanged(hostIdentities) }
    // A host joined or left: seal this device's push key for the new set.
    if pushToken != nil, next.map(\.member) != previousMembers {
      Task { await syncPushRegistration() }
    }
  }

  /// Account hosts as connectable identities: the log's Noise key pinned, this
  /// device's account-wide key to dial with. The bundled host isn't remote.
  public var hostIdentities: [DeviceIdentity] {
    guard let keys = vault.keys else { return [] }
    return hosts.filter { !$0.isLocal }.map { host in
      let endpoints = host.endpoints.sorted { $0.priority < $1.priority }
      return DeviceIdentity(
        deviceId: "account:\(host.id)", devPrivB64: keys.noisePriv, devPubB64: keys.noisePub,
        desktopPubB64: host.member.noisePub, url: endpoints.first?.url ?? "", endpoints: endpoints,
        capabilities: [], hostName: host.name, source: .account, accountHostId: host.id)
    }
  }

  // MARK: Members

  /// Take a host or device off the account.
  public func remove(memberId: String) async {
    guard let target = state?.liveMember(memberId) else { return }
    error = nil
    do {
      try await appendWithRetry { [self] head in
        [try entry(head: head, .revoke(memberId: memberId, reason: "removed"))]
      }
      vault.presence[memberId] = nil
      publishHosts()
      onEvent(.memberRemoved(role: target.member.role))
    } catch {
      self.error = Self.describe(error)
    }
  }
}
