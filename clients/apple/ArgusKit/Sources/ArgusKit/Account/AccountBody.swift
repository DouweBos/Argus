import Foundation

/// A parsed log entry body. Mirrors the zod `LogBody` schema in
/// `packages/remote-protocol/src/account/schema.ts`: unknown keys are ignored,
/// anything else off-schema is `malformed`.
struct AccountBody {
  enum Fields {
    case genesis(member: AccountMember)
    case add(member: AccountMember, requestId: String, sasCommit: String, proof: String)
    case revoke(memberId: String, reason: String)
    case rotate(memberId: String, signPub: String, noisePub: String, proof: String)
    case rename(memberId: String, name: String)
  }

  var accountId: String
  var epoch: Int
  var seq: Int
  var prev: String
  var signer: String
  var fields: Fields

  static func parse(_ body: String) throws(AccountLogRejectReason) -> AccountBody {
    guard let raw = try? JSONSerialization.jsonObject(with: Data(body.utf8), options: [.fragmentsAllowed]),
      let object = raw as? [String: Any]
    else { throw .malformed }
    return try parse(object)
  }

  /// The signer a body claims, read before anything is trusted so the right
  /// key can check it. Unparseable is `malformed`; a non-object has none.
  static func claimedSigner(_ body: String) throws(AccountLogRejectReason) -> String {
    guard let raw = try? JSONSerialization.jsonObject(with: Data(body.utf8), options: [.fragmentsAllowed]),
      !(raw is NSNull)
    else { throw .malformed }
    return (raw as? [String: Any])?["signer"] as? String ?? ""
  }

  private static func parse(_ o: [String: Any]) throws(AccountLogRejectReason) -> AccountBody {
    guard JSONField.number(o["v"]) == 1,
      let accountId = JSONField.string(o["account_id"], min: 1),
      let epoch = JSONField.nonNegativeInt(o["epoch"]),
      let seq = JSONField.nonNegativeInt(o["seq"]),
      let prev = JSONField.string(o["prev"]),
      JSONField.number(o["ts"]) != nil,
      let signer = JSONField.string(o["signer"], min: 1),
      let type = JSONField.string(o["type"])
    else { throw .malformed }

    let fields: Fields
    switch type {
    case "genesis":
      guard let member = member(o["member"]) else { throw .malformed }
      fields = .genesis(member: member)
    case "add_device", "add_host":
      guard let member = member(o["member"]),
        member.role == (type == "add_device" ? .device : .host),
        let requestId = JSONField.string(o["request_id"]),
        let sasCommit = JSONField.string(o["sas_commit"]),
        let proof = JSONField.string(o["proof"], min: 1)
      else { throw .malformed }
      fields = .add(member: member, requestId: requestId, sasCommit: sasCommit, proof: proof)
    case "revoke":
      guard let memberId = JSONField.string(o["member_id"], min: 1),
        let reason = JSONField.string(o["reason"]),
        ["removed", "lost", "unlinked"].contains(reason)
      else { throw .malformed }
      fields = .revoke(memberId: memberId, reason: reason)
    case "rotate":
      guard let memberId = JSONField.string(o["member_id"], min: 1),
        let signPub = JSONField.string(o["sign_pub"], min: 1),
        let noisePub = JSONField.string(o["noise_pub"], min: 1),
        let proof = JSONField.string(o["proof"], min: 1)
      else { throw .malformed }
      fields = .rotate(memberId: memberId, signPub: signPub, noisePub: noisePub, proof: proof)
    case "rename":
      guard let memberId = JSONField.string(o["member_id"], min: 1),
        let name = JSONField.string(o["name"]), validName(name)
      else { throw .malformed }
      fields = .rename(memberId: memberId, name: name)
    default:
      throw .malformed
    }
    return AccountBody(
      accountId: accountId, epoch: epoch, seq: seq, prev: prev, signer: signer, fields: fields)
  }

  static func member(_ value: Any?) -> AccountMember? {
    guard let o = value as? [String: Any],
      let id = JSONField.string(o["id"], min: 1),
      let signPub = JSONField.string(o["sign_pub"], min: 1),
      let noisePub = JSONField.string(o["noise_pub"], min: 1),
      let name = JSONField.string(o["name"]), validName(name),
      let createdAt = JSONField.number(o["created_at"]),
      let role = JSONField.string(o["role"])
    else { return nil }
    switch role {
    case "device":
      guard let kind = JSONField.string(o["kind"]), ["ios", "mac", "electron", "web"].contains(kind) else {
        return nil
      }
      return AccountMember(
        id: id, role: .device, kind: kind, signPub: signPub, noisePub: noisePub, name: name,
        createdAt: createdAt)
    case "host":
      guard let platform = JSONField.string(o["platform"]), ["darwin", "linux"].contains(platform)
      else { return nil }
      return AccountMember(
        id: id, role: .host, platform: platform, signPub: signPub, noisePub: noisePub, name: name,
        createdAt: createdAt)
    default:
      return nil
    }
  }

  /// 1–64 UTF-16 units (zod counts them that way), no control characters.
  static func validName(_ name: String) -> Bool {
    let units = name.utf16
    guard (1...64).contains(units.count) else { return false }
    return !units.contains { $0 < 0x20 || $0 == 0x7f }
  }
}

/// Typed reads off `JSONSerialization` output, as `JSON.parse` + zod see them.
enum JSONField {
  static func string(_ value: Any?, min: Int = 0) -> String? {
    guard let s = value as? String, s.utf16.count >= min else { return nil }
    return s
  }

  /// A JSON number — never a boolean, which Foundation also hands back as `NSNumber`.
  static func number(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
  }

  static func nonNegativeInt(_ value: Any?) -> Int? {
    guard let d = number(value), d >= 0, d.rounded() == d else { return nil }
    return Int(exactly: d)
  }
}
