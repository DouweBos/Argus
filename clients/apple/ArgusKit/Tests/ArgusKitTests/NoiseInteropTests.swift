import Foundation
import Testing
@testable import ArgusKit

/// Interop vectors generated from the desktop gateway's own implementation
/// (`packages/host/src/services/remote/noise.ts`) — the peer this port actually
/// handshakes with. If any of these fail, no phone will complete a handshake.
///
/// Regenerate with the script documented in `clients/apple/README.md`.
struct NoiseVectors: Decodable {
  struct Run: Decodable {
    var psk: String?
    var iStaticPriv, iStaticPub, rStaticPriv, rStaticPub: String
    var iEphPriv, rEphPriv: String
    var msg0, msg1: String
    var handshakeHash, responderHandshakeHash, sas: String
    var ct1, pt1, ct2, pt2, ct3: String
    var remoteStaticSeenByResponder: String
  }
  var ik: Run
  var ikpsk1: Run
  var pairingPsk: String
  var sasOfZeros: String
}

private func b64(_ s: String) -> Data { ArgusBase64.decode(s)! }

private func loadVectors() throws -> NoiseVectors {
  let url = Bundle.module.url(forResource: "noise-vectors", withExtension: "json")!
  return try JSONDecoder().decode(NoiseVectors.self, from: Data(contentsOf: url))
}

private func keypair(priv: String) throws -> NoiseKeypair {
  let p = b64(priv)
  return NoiseKeypair(priv: p, pub: try NoiseCrypto.publicKey(from: p))
}

@Suite("Noise interop with the TypeScript implementation")
struct NoiseInteropTests {

  @Test("derived public keys match")
  func publicKeys() throws {
    let v = try loadVectors()
    #expect(try NoiseCrypto.publicKey(from: b64(v.ik.iStaticPriv)) == b64(v.ik.iStaticPub))
    #expect(try NoiseCrypto.publicKey(from: b64(v.ik.rStaticPriv)) == b64(v.ik.rStaticPub))
  }

  @Test("pairing PSK derivation matches (RFC-5869 HKDF)")
  func pairingPSK() throws {
    let v = try loadVectors()
    let psk = ArgusDerive.pairingPSK(from: Data(repeating: 9, count: 32))
    #expect(ArgusBase64.encode(psk) == v.pairingPsk)
  }

  @Test("SAS derivation matches")
  func sas() throws {
    let v = try loadVectors()
    #expect(ArgusDerive.sas(handshakeHash: Data(repeating: 0, count: 32)) == v.sasOfZeros)
    #expect(ArgusDerive.sas(handshakeHash: b64(v.ik.handshakeHash)) == v.ik.sas)
    #expect(ArgusDerive.sas(handshakeHash: b64(v.ikpsk1.handshakeHash)) == v.ikpsk1.sas)
  }

  /// The critical one: our initiator must produce the exact bytes the TS
  /// initiator produced, given the same static and ephemeral keys.
  @Test("initiator writes byte-identical msg0", arguments: [false, true])
  func initiatorBytes(usePsk: Bool) throws {
    let all = try loadVectors()
    let v = usePsk ? all.ikpsk1 : all.ik

    let hs = try NoiseHandshake(
      NoiseHandshakeConfig(
        role: .initiator,
        staticKey: try keypair(priv: v.iStaticPriv),
        remoteStatic: b64(v.rStaticPub),
        psk: v.psk.map(b64),
        ephemeral: try keypair(priv: v.iEphPriv)
      )
    )
    let msg0 = try hs.writeMessage(Data())
    #expect(ArgusBase64.encode(msg0) == v.msg0)

    // And consuming the TS responder's reply must land on the same hash.
    let payload = try hs.readMessage(b64(v.msg1))
    #expect(payload.isEmpty)
    #expect(ArgusBase64.encode(try hs.handshakeHash()) == v.handshakeHash)
  }

  @Test("responder reads the TS initiator and replies identically", arguments: [false, true])
  func responderBytes(usePsk: Bool) throws {
    let all = try loadVectors()
    let v = usePsk ? all.ikpsk1 : all.ik

    let hs = try NoiseHandshake(
      NoiseHandshakeConfig(
        role: .responder,
        staticKey: try keypair(priv: v.rStaticPriv),
        psk: v.psk.map(b64),
        ephemeral: try keypair(priv: v.rEphPriv)
      )
    )
    let payload = try hs.readMessage(b64(v.msg0))
    #expect(payload.isEmpty)
    // The responder learns and pins the initiator's static key here.
    #expect(ArgusBase64.encode(try hs.remoteStaticKey()) == v.remoteStaticSeenByResponder)

    let msg1 = try hs.writeMessage(Data())
    #expect(ArgusBase64.encode(msg1) == v.msg1)
    #expect(ArgusBase64.encode(try hs.handshakeHash()) == v.responderHandshakeHash)
  }

  /// Transport framing, including that the nonce counter advances per direction.
  @Test("transport ciphertexts match and decrypt", arguments: [false, true])
  func transport(usePsk: Bool) throws {
    let all = try loadVectors()
    let v = usePsk ? all.ikpsk1 : all.ik

    let ini = try NoiseHandshake(
      NoiseHandshakeConfig(
        role: .initiator,
        staticKey: try keypair(priv: v.iStaticPriv),
        remoteStatic: b64(v.rStaticPub),
        psk: v.psk.map(b64),
        ephemeral: try keypair(priv: v.iEphPriv)
      )
    )
    _ = try ini.writeMessage(Data())
    _ = try ini.readMessage(b64(v.msg1))
    let session = try ini.session()

    // Our first two sends must equal the TS initiator's first two sends.
    #expect(ArgusBase64.encode(try session.encrypt(Data(v.pt1.utf8))) == v.ct1)
    // Decrypting the responder's frame exercises the receive direction.
    #expect(String(decoding: try session.decrypt(b64(v.ct2)), as: UTF8.self) == v.pt2)
    #expect(ArgusBase64.encode(try session.encrypt(Data("third".utf8))) == v.ct3)
  }

  @Test("a wrong pinned key fails the handshake rather than degrading")
  func wrongPinnedKey() throws {
    let v = try loadVectors().ik
    let wrong = try NoiseCrypto.publicKey(from: Data(repeating: 7, count: 32))
    let hs = try NoiseHandshake(
      NoiseHandshakeConfig(
        role: .initiator,
        staticKey: try keypair(priv: v.iStaticPriv),
        remoteStatic: wrong,
        ephemeral: try keypair(priv: v.iEphPriv)
      )
    )
    _ = try hs.writeMessage(Data())
    #expect(throws: NoiseError.decryptionFailed) {
      _ = try hs.readMessage(b64(v.msg1))
    }
  }

  @Test("a full Swift-to-Swift handshake round-trips")
  func selfRoundTrip() throws {
    let iStatic = NoiseCrypto.generateKeypair()
    let rStatic = NoiseCrypto.generateKeypair()
    let ini = try NoiseHandshake(
      NoiseHandshakeConfig(role: .initiator, staticKey: iStatic, remoteStatic: rStatic.pub))
    let res = try NoiseHandshake(
      NoiseHandshakeConfig(role: .responder, staticKey: rStatic))

    _ = try res.readMessage(try ini.writeMessage(Data()))
    _ = try ini.readMessage(try res.writeMessage(Data()))

    let a = try ini.session()
    let b = try res.session()
    let msg = Data("round trip".utf8)
    #expect(try b.decrypt(try a.encrypt(msg)) == msg)
    #expect(try a.decrypt(try b.encrypt(msg)) == msg)
    #expect(try ini.handshakeHash() == res.handshakeHash())
  }
}
