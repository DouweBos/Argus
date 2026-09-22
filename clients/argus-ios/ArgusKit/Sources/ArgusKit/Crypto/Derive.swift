import CryptoKit
import Foundation

/// Key and identifier derivations — a byte-for-byte mirror of the desktop's
/// `packages/host/src/services/remote/derive.ts`. Constants are inlined so this
/// stays standalone. Any change here MUST match the desktop or pairing breaks.
public enum ArgusDerive {
  private static let pairingHKDFInfo = "argus-pair-v1"
  private static let sasDigits = 6

  /// RFC-5869 HKDF — deliberately *not* the Noise HKDF used during the handshake.
  public static func pairingPSK(from pairingSecret: Data) -> Data {
    let key = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: pairingSecret),
      salt: Data(),
      info: Data(pairingHKDFInfo.utf8),
      outputByteCount: 32
    )
    return key.withUnsafeBytes { Data($0) }
  }

  /// The 6-digit short authentication string both ends display before pairing.
  public static func sas(handshakeHash: Data) -> String {
    let digest = Data(SHA256.hash(data: handshakeHash))
    let code = digest.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    let modulus = UInt32(pow(10.0, Double(sasDigits)))
    return String(format: "%0\(sasDigits)u", code % modulus)
  }
}
