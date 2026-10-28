import CryptoKit
import Foundation

/// This install's push key, sealed for one account host (phase 3). The wrapping
/// key comes from this device's Noise key and the host's, both pinned in the
/// signed log, so only this device could have sealed it and only that host can
/// open it; the account service just stores the blob. Mirrors
/// `packages/host/src/services/account/pushKey.ts` (fixture `push_key.json`).
public enum AccountPushKey {
  static let salt = Data("argus-account-pushkey-v1".utf8)

  public enum SealError: Error {
    case badKey
  }

  static func wrappingKey(priv: Data, pub: Data, deviceId: String, hostId: String) throws -> SymmetricKey {
    let shared = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: priv)
      .sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: pub))
    return shared.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: salt, sharedInfo: Data("\(deviceId)\n\(hostId)".utf8), outputByteCount: 32)
  }

  /// `nonce(12) ‖ ciphertext(32) ‖ tag(16)`, standard base64.
  public static func seal(
    pushKey: Data, deviceNoisePriv: Data, hostNoisePub: Data, deviceId: String, hostId: String,
    nonce: Data? = nil
  ) throws -> String {
    guard pushKey.count == 32 else { throw SealError.badKey }
    let key = try wrappingKey(priv: deviceNoisePriv, pub: hostNoisePub, deviceId: deviceId, hostId: hostId)
    let box = try AES.GCM.seal(
      pushKey, using: key, nonce: try nonce.map { try AES.GCM.Nonce(data: $0) } ?? AES.GCM.Nonce())
    return AccountCodec.b64(Data(box.nonce) + box.ciphertext + box.tag)
  }

  /// What a host does; here so tests can check both directions.
  public static func open(
    _ sealed: String, hostNoisePriv: Data, deviceNoisePub: Data, deviceId: String, hostId: String
  ) -> Data? {
    guard let blob = AccountCodec.fromB64(sealed), blob.count == 60,
      let key = try? wrappingKey(priv: hostNoisePriv, pub: deviceNoisePub, deviceId: deviceId, hostId: hostId),
      let box = try? AES.GCM.SealedBox(
        nonce: AES.GCM.Nonce(data: blob.prefix(12)), ciphertext: blob.dropFirst(12).dropLast(16),
        tag: blob.suffix(16))
    else { return nil }
    return try? AES.GCM.open(box, using: key)
  }
}

/// `PUT /push/registration`: this device's token, with its push key sealed per host.
public struct AccountPushRegistration: Encodable, Equatable, Sendable {
  public var deviceId: String
  /// `apns` (or `fcm`).
  public var service: String
  public var token: String
  /// `production` or `sandbox`.
  public var environment: String
  /// Host member id → sealed push key.
  public var sealedKeys: [String: String]

  public init(deviceId: String, service: String, token: String, environment: String, sealedKeys: [String: String]) {
    self.deviceId = deviceId
    self.service = service
    self.token = token
    self.environment = environment
    self.sealedKeys = sealedKeys
  }

  enum CodingKeys: String, CodingKey {
    case service, token, environment
    case deviceId = "device_id"
    case sealedKeys = "sealed_keys"
  }
}
