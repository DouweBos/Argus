import Foundation
import Testing

@testable import ArgusKit

/// The phone seals its push key byte-for-byte like the TS fixture, so the host opens it.
@Suite("Account push key")
struct AccountPushKeyTests {
  struct Vector: Decodable {
    let device_id: String
    let host_id: String
    let device_noise_priv: String
    let device_noise_pub: String
    let host_noise_priv: String
    let host_noise_pub: String
    let push_key: String
    let nonce: String
    let sealed: String
  }

  static func vector() throws -> Vector {
    try AccountLogTests.load("push_key.json", as: Vector.self)
  }

  static func data(_ b64: String) -> Data { AccountCodec.fromB64(b64)! }

  @Test("seals exactly like the host's fixture")
  func sealsLikeFixture() throws {
    let v = try Self.vector()
    let sealed = try AccountPushKey.seal(
      pushKey: Self.data(v.push_key), deviceNoisePriv: Self.data(v.device_noise_priv),
      hostNoisePub: Self.data(v.host_noise_pub), deviceId: v.device_id, hostId: v.host_id,
      nonce: Self.data(v.nonce))
    #expect(sealed == v.sealed)
  }

  @Test("only the host it was sealed for opens it")
  func opensOnlyForItsHost() throws {
    let v = try Self.vector()
    let opened = AccountPushKey.open(
      v.sealed, hostNoisePriv: Self.data(v.host_noise_priv), deviceNoisePub: Self.data(v.device_noise_pub),
      deviceId: v.device_id, hostId: v.host_id)
    #expect(opened == Self.data(v.push_key))
    let other = AccountPushKey.open(
      v.sealed, hostNoisePriv: Self.data(v.host_noise_priv), deviceNoisePub: Self.data(v.device_noise_pub),
      deviceId: v.device_id, hostId: "00000000-0000-4000-8000-000000000003")
    #expect(other == nil)
  }

  @Test("registration encodes the wire keys")
  func registrationKeys() throws {
    let reg = AccountPushRegistration(
      deviceId: "d", service: "apns", token: "t", environment: "sandbox", sealedKeys: ["h": "s"])
    let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(reg)) as? [String: Any]
    #expect(json?["device_id"] as? String == "d")
    #expect(json?["sealed_keys"] as? [String: String] == ["h": "s"])
  }
}
