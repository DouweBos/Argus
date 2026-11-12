import CryptoKit
import Foundation

/// The exact byte strings every account signature covers, and the codecs they
/// rely on. A byte-for-byte mirror of `packages/remote-protocol/src/account/sign.ts`.
public enum AccountCodec {
  static let entryPrefix = "argus-account-v1\n"
  static let proofPrefix = "argus-account-proof-v1\n"
  static let presencePrefix = "argus-account-presence-v1\n"
  static let requestPrefix = "argus-account-req-v1\n"

  // MARK: Base64 and hex

  /// Standard base64 with padding — the only key/signature encoding on the wire.
  public static func b64(_ data: Data) -> String { data.base64EncodedString() }

  /// Strict decode, like the TS `fromB64`: standard or url-safe, padding
  /// optional, anything else is an error rather than silently skipped.
  public static func fromB64(_ value: String) -> Data? {
    var clean = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while clean.hasSuffix("=") { clean.removeLast() }
    let alphabet = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")
    guard clean.allSatisfy(alphabet.contains), clean.count % 4 != 1 else { return nil }
    let padding = (4 - clean.count % 4) % 4
    return Data(base64Encoded: clean + String(repeating: "=", count: padding))
  }

  public static func hex(_ data: some Sequence<UInt8>) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  public static func fromHex(_ value: String) -> Data? {
    guard value.count % 2 == 0 else { return nil }
    var out = Data(capacity: value.count / 2)
    var index = value.startIndex
    while index < value.endIndex {
      let next = value.index(index, offsetBy: 2)
      guard let byte = UInt8(value[index..<next], radix: 16) else { return nil }
      out.append(byte)
      index = next
    }
    return out
  }

  public static func sha256Hex(_ data: Data) -> String { hex(SHA256.hash(data: data)) }
  public static func sha256Hex(_ string: String) -> String { sha256Hex(Data(string.utf8)) }

  /// `entry_hash`: what the next entry's `prev` names.
  public static func entryHash(_ body: String) -> String { sha256Hex(body) }

  // MARK: Signed messages

  public static func entrySigningBytes(_ body: String) -> Data { Data((entryPrefix + body).utf8) }

  /// A member's key vouching for its own identity (proof of possession).
  public static func proofSigningBytes(id: String, role: String, signPub: String, noisePub: String)
    -> Data
  {
    Data("\(proofPrefix)\(id)\n\(role)\n\(signPub)\n\(noisePub)".utf8)
  }

  public static func presenceSigningBytes(_ body: String) -> Data { Data((presencePrefix + body).utf8) }

  /// What a member signs to authenticate one HTTP request to the service.
  public static func requestSigningBytes(method: String, pathAndQuery: String, ts: Int64, body: Data) -> Data {
    Data("\(requestPrefix)\(method.uppercased())\n\(pathAndQuery)\n\(ts)\n\(sha256Hex(body))".utf8)
  }

  // MARK: Ed25519

  /// Never throws: a malformed key or signature is just a failed verify.
  public static func verify(_ message: Data, signature: String, publicKey: String) -> Bool {
    guard let sig = fromB64(signature), let pub = fromB64(publicKey),
      sig.count == 64, pub.count == 32,
      let key = try? Curve25519.Signing.PublicKey(rawRepresentation: pub)
    else { return false }
    return key.isValidSignature(sig, for: message)
  }

  /// Ed25519 over `message` with a 32-byte seed, base64 out.
  public static func sign(_ message: Data, seed: Data) throws -> String {
    let key = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
    return b64(try key.signature(for: message))
  }

  public static func signingPublicKey(seed: Data) throws -> String {
    b64(try Curve25519.Signing.PrivateKey(rawRepresentation: seed).publicKey.rawRepresentation)
  }

  /// `XXXX-XXXX-XXXX` from the genesis hash, for a by-eye account check.
  public static func safetyCode(genesisHash: String) -> String {
    let head = Array(genesisHash.prefix(12).uppercased())
    guard head.count == 12 else { return String(head) }
    return "\(String(head[0..<4]))-\(String(head[4..<8]))-\(String(head[8..<12]))"
  }

  /// A typed link code, normalized: `XXXX-XXXX` from the 20-letter alphabet.
  public static func normalizeUserCode(_ input: String) -> String {
    let alphabet = Set("BCDFGHJKLMNPQRSTVWXZ")
    let letters = input.uppercased().filter(alphabet.contains)
    guard letters.count > 4 else { return String(letters) }
    return String(letters.prefix(4)) + "-" + String(letters.dropFirst(4))
  }
}
