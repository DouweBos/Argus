import Foundation

/// The account log verifier: one pure function every client runs over the
/// entries the (untrusted) service hands out. A mirror of
/// `packages/remote-protocol/src/account/log.ts`, held to the same fixtures —
/// the check order matters, because the fixtures pin the reason and index.
public enum AccountLog {
  /// Verify `entries` on top of `prior` (or from genesis when there is none).
  /// Pass `root` to pin the account already trusted; a log that starts
  /// anywhere else is a fork.
  public static func verify(
    _ entries: [AccountEntry], root: AccountRoot? = nil, prior: AccountLogState? = nil
  ) -> AccountVerifyResult {
    var state = prior
    if let state, let root, state.genesisHash != root.genesisHash {
      return .rejected(reason: .fork, index: 0, state: nil)
    }
    for (index, entry) in entries.enumerated() {
      do {
        if let current = state {
          state = try apply(entry, to: current)
        } else {
          state = try genesis(entry, root: root)
        }
      } catch {
        return .rejected(reason: error, index: index, state: state)
      }
    }
    guard let state else { return .rejected(reason: .malformed, index: 0, state: nil) }
    return .ok(state)
  }

  private static func genesis(_ entry: AccountEntry, root: AccountRoot?) throws(AccountLogRejectReason)
    -> AccountLogState
  {
    let body = try AccountBody.parse(entry.body)
    guard case .genesis(let member) = body.fields else { throw .fork }
    guard let sig = entry.sigs[body.signer],
      AccountCodec.verify(AccountCodec.entrySigningBytes(entry.body), signature: sig, publicKey: member.signPub)
    else { throw .badSignature }
    guard body.seq == 0, body.prev.isEmpty else { throw .fork }
    guard body.signer == member.id else { throw .unknownSigner }
    let hash = AccountCodec.entryHash(entry.body)
    if let root, root.accountId != body.accountId || root.epoch != body.epoch || root.genesisHash != hash {
      throw .fork
    }
    return AccountLogState(
      accountId: body.accountId, epoch: body.epoch, genesisHash: hash,
      head: AccountHead(seq: 0, hash: hash),
      members: [
        member.id: AccountMemberState(
          member: member, live: true, requestId: "", sasCommit: "", addedBy: member.id)
      ])
  }

  private static func apply(_ entry: AccountEntry, to prior: AccountLogState) throws(AccountLogRejectReason)
    -> AccountLogState
  {
    var state = prior
    let signerId = try AccountBody.claimedSigner(entry.body)
    guard let signer = state.members[signerId] else { throw .unknownSigner }
    guard let sig = entry.sigs[signerId],
      AccountCodec.verify(
        AccountCodec.entrySigningBytes(entry.body), signature: sig, publicKey: signer.member.signPub)
    else { throw .badSignature }
    let body = try AccountBody.parse(entry.body)
    guard body.accountId == state.accountId, body.epoch == state.epoch,
      body.seq == state.head.seq + 1, body.prev == state.head.hash
    else { throw .fork }
    guard signer.live else { throw .unknownSigner }
    let signerIsHost = signer.member.role == .host

    switch body.fields {
    case .genesis:
      throw .fork
    case .add(let member, let requestId, let sasCommit, let proof):
      guard state.members[member.id] == nil, !state.signKeyInUse(member.signPub) else { throw .malformed }
      guard AccountCodec.verify(member.proofBytes, signature: proof, publicKey: member.signPub) else {
        throw .badSignature
      }
      state.members[member.id] = AccountMemberState(
        member: member, live: true, requestId: requestId, sasCommit: sasCommit, addedBy: signerId)
    case .revoke(let memberId, _):
      if signerIsHost, memberId != signerId { throw .unknownSigner }
      guard state.liveMember(memberId) != nil else { throw .malformed }
      state.members[memberId]?.live = false
    case .rotate(let memberId, let signPub, let noisePub, let proof):
      guard memberId == signerId else { throw .unknownSigner }
      guard let target = state.liveMember(memberId), !state.signKeyInUse(signPub) else {
        throw .malformed
      }
      let message = AccountCodec.proofSigningBytes(
        id: memberId, role: target.member.role.rawValue, signPub: signPub, noisePub: noisePub)
      guard AccountCodec.verify(message, signature: proof, publicKey: signPub) else { throw .badSignature }
      state.members[memberId]?.member.signPub = signPub
      state.members[memberId]?.member.noisePub = noisePub
    case .rename(let memberId, let name):
      if signerIsHost, memberId != signerId { throw .unknownSigner }
      guard state.liveMember(memberId) != nil else { throw .malformed }
      state.members[memberId]?.member.name = name
    }
    state.head = AccountHead(seq: body.seq, hash: AccountCodec.entryHash(entry.body))
    return state
  }

  /// A presence record only counts when its live host signed it for this account.
  public static func verifyPresence(_ record: AccountDirectoryRecord, state: AccountLogState)
    -> AccountPresence?
  {
    guard let host = state.liveMember(record.hostId), host.member.role == .host,
      AccountCodec.verify(
        AccountCodec.presenceSigningBytes(record.presenceBody), signature: record.presenceSig,
        publicKey: host.member.signPub),
      let raw = try? JSONSerialization.jsonObject(with: Data(record.presenceBody.utf8)),
      let o = raw as? [String: Any],
      JSONField.number(o["v"]) == 1,
      let accountId = JSONField.string(o["account_id"]),
      let epoch = JSONField.nonNegativeInt(o["epoch"]),
      let hostId = JSONField.string(o["host_id"]),
      let ts = JSONField.number(o["ts"]),
      let list = o["endpoints"] as? [Any],
      hostId == record.hostId, accountId == state.accountId, epoch == state.epoch
    else { return nil }
    var endpoints: [RemoteEndpoint] = []
    for item in list {
      guard let e = item as? [String: Any],
        let kind = JSONField.string(e["kind"]).flatMap(RemoteEndpoint.Kind.init(rawValue:)),
        let url = JSONField.string(e["url"]),
        let priority = JSONField.number(e["priority"])
      else { return nil }
      endpoints.append(RemoteEndpoint(kind: kind, url: url, priority: Int(priority)))
    }
    return AccountPresence(hostId: hostId, ts: ts, endpoints: endpoints)
  }
}
