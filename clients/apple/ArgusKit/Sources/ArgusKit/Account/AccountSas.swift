import CryptoKit
import Foundation

/// The 6-digit code both sides of an account approval compare. It binds the
/// approver, the subject's keys and the log head, so a swapped key or a fork
/// shown to either side gives a different code. Mirrors `account/sas.ts`.
public struct AccountSas: Equatable, Sendable {
  public struct Input: Sendable {
    public var accountId: String
    public var epoch: Int
    public var headHash: String
    public var approverSignPub: String
    public var subjectSignPub: String
    public var subjectNoisePub: String
    public var requestId: String

    public init(
      accountId: String, epoch: Int, headHash: String, approverSignPub: String,
      subjectSignPub: String, subjectNoisePub: String, requestId: String
    ) {
      self.accountId = accountId
      self.epoch = epoch
      self.headHash = headHash
      self.approverSignPub = approverSignPub
      self.subjectSignPub = subjectSignPub
      self.subjectNoisePub = subjectNoisePub
      self.requestId = requestId
    }
  }

  public enum InputError: Error, Equatable {
    case badEncoding
  }

  public var sas: String
  /// Written into the `add_*` entry so the subject can check what it confirmed.
  public var commit: String

  public static func compute(_ input: Input) throws(InputError) -> AccountSas {
    let digest = Data(SHA256.hash(data: try transcript(input)))
    return AccountSas(sas: ArgusDerive.sas(handshakeHash: digest), commit: AccountCodec.hex(digest))
  }

  static func transcript(_ input: Input) throws(InputError) -> Data {
    guard let head = AccountCodec.fromHex(input.headHash),
      let approver = AccountCodec.fromB64(input.approverSignPub),
      let subjectSign = AccountCodec.fromB64(input.subjectSignPub),
      let subjectNoise = AccountCodec.fromB64(input.subjectNoisePub),
      let epoch = UInt32(exactly: input.epoch)
    else { throw .badEncoding }
    var out = Data()
    for part in [
      Data("argus-account-sas-v1".utf8), Data(input.accountId.utf8), u32be(epoch), head, approver,
      subjectSign, subjectNoise, Data(input.requestId.utf8),
    ] {
      out.append(u32be(UInt32(part.count)))
      out.append(part)
    }
    return out
  }

  private static func u32be(_ n: UInt32) -> Data {
    withUnsafeBytes(of: n.bigEndian) { Data($0) }
  }
}
