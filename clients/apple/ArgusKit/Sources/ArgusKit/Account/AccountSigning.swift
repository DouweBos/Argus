import Foundation

/// The member that signs an entry: its id and Ed25519 seed.
public struct AccountSigner: Sendable {
  public var id: String
  public var seed: Data

  public init(id: String, seed: Data) {
    self.id = id
    self.seed = seed
  }
}

/// Writing log entries. A body is serialized once and that exact string is
/// signed and stored, so no canonical JSON is ever needed. Mirrors `entries.ts`.
public enum AccountEntryBuilder {
  public enum Fields: Sendable {
    case genesis(member: AccountMember)
    case addDevice(member: AccountMember, requestId: String, sasCommit: String, proof: String)
    case addHost(member: AccountMember, requestId: String, sasCommit: String, proof: String)
    case revoke(memberId: String, reason: String)
    case rename(memberId: String, name: String)
  }

  public enum BuildError: Error {
    case encoding
  }

  /// Sign one entry that extends `head` (nil for genesis).
  public static func make(
    accountId: String, epoch: Int, head: AccountHead?, ts: Int64 = nowMs(),
    signer: AccountSigner, _ fields: Fields
  ) throws -> AccountEntry {
    var body: [String: Any] = [
      "v": 1,
      "account_id": accountId,
      "epoch": epoch,
      "seq": head.map { $0.seq + 1 } ?? 0,
      "prev": head?.hash ?? "",
      "ts": ts,
      "signer": signer.id,
    ]
    switch fields {
    case .genesis(let member):
      body["type"] = "genesis"
      body["member"] = try json(member)
    case .addDevice(let member, let requestId, let sasCommit, let proof),
      .addHost(let member, let requestId, let sasCommit, let proof):
      if case .addDevice = fields { body["type"] = "add_device" } else { body["type"] = "add_host" }
      body["member"] = try json(member)
      body["request_id"] = requestId
      body["sas_commit"] = sasCommit
      body["proof"] = proof
    case .revoke(let memberId, let reason):
      body["type"] = "revoke"
      body["member_id"] = memberId
      body["reason"] = reason
    case .rename(let memberId, let name):
      body["type"] = "rename"
      body["member_id"] = memberId
      body["name"] = name
    }
    let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys, .withoutEscapingSlashes])
    guard let text = String(data: data, encoding: .utf8) else { throw BuildError.encoding }
    let sig = try AccountCodec.sign(AccountCodec.entrySigningBytes(text), seed: signer.seed)
    return AccountEntry(body: text, sigs: [signer.id: sig])
  }

  /// A member's own key vouching for its id and keys.
  public static func proof(for member: AccountMember, seed: Data) throws -> String {
    try AccountCodec.sign(member.proofBytes, seed: seed)
  }

  public static func nowMs() -> Int64 { Int64((Date().timeIntervalSince1970 * 1000).rounded()) }

  private static func json(_ member: AccountMember) throws -> Any {
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(member))
  }
}
