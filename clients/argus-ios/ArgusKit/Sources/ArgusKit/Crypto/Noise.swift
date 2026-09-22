import CryptoKit
import Foundation

/// Noise Protocol Framework — IK pattern, `25519_ChaChaPoly_SHA256`, with an
/// optional `psk1` variant used only during device pairing.
///
/// A faithful port of the documented Noise state machine (revision 34), kept
/// byte-for-byte compatible with the desktop gateway's
/// `packages/host/src/services/remote/noise.ts`. Any drift here breaks every
/// handshake — change both or neither.
///
/// IK:
///     <- s                       (pre-message: initiator knows responder static)
///     -> e, es, s, ss [, psk]    (psk token present only in the psk1 variant)
///     <- e, ee, se

private let hashLen = 32
private let dhLen = 32
private let tagLen = 16

public struct NoiseKeypair: Sendable {
  public var priv: Data
  public var pub: Data

  public init(priv: Data, pub: Data) {
    self.priv = priv
    self.pub = pub
  }
}

public enum NoiseRole: Sendable {
  case initiator
  case responder
}

public enum NoiseError: Error, Equatable {
  case nonceExhausted
  case notYourTurn
  case handshakeIncomplete
  case missingRemoteStatic
  case truncatedMessage
  case decryptionFailed
  case sessionWithoutKeys
}

public enum NoiseCrypto {
  public static func generateKeypair() -> NoiseKeypair {
    let priv = Curve25519.KeyAgreement.PrivateKey()
    return NoiseKeypair(
      priv: priv.rawRepresentation,
      pub: priv.publicKey.rawRepresentation
    )
  }

  public static func publicKey(from priv: Data) throws -> Data {
    try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: priv)
      .publicKey.rawRepresentation
  }

  static func dh(_ kp: NoiseKeypair, _ pub: Data) throws -> Data {
    let priv = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: kp.priv)
    let peer = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: pub)
    let shared = try priv.sharedSecretFromKeyAgreement(with: peer)
    return shared.withUnsafeBytes { Data($0) }
  }
}

/// Noise HKDF: HMAC-chained outputs. **Not** RFC-5869 — the pairing PSK
/// derivation in `Derive.swift` is the RFC one, and the two must not be mixed up.
func noiseHKDF(chainingKey: Data, ikm: Data, num: Int) -> [Data] {
  func mac(_ key: Data, _ msg: Data) -> Data {
    Data(HMAC<SHA256>.authenticationCode(
      for: msg,
      using: SymmetricKey(data: key)
    ))
  }
  let tempKey = mac(chainingKey, ikm)
  let o1 = mac(tempKey, Data([1]))
  let o2 = mac(tempKey, o1 + Data([2]))
  if num == 2 { return [o1, o2] }
  let o3 = mac(tempKey, o2 + Data([3]))
  return [o1, o2, o3]
}

/// Noise's 96-bit nonce: 4 zero bytes followed by the 64-bit little-endian counter.
private func nonceBytes(_ n: UInt64) -> Data {
  var out = Data(repeating: 0, count: 12)
  withUnsafeBytes(of: n.littleEndian) { raw in
    out.replaceSubrange(4..<12, with: raw)
  }
  return out
}

/// Noise reserves 2^64-1; refuse to encrypt or decrypt at or past it.
private let maxNonce = UInt64.max

final class CipherState {
  private var key: SymmetricKey?
  private var n: UInt64 = 0

  func initializeKey(_ key: Data?) {
    self.key = key.map { SymmetricKey(data: $0) }
    self.n = 0
  }

  var hasKey: Bool { key != nil }

  func encryptWithAd(_ ad: Data, _ plaintext: Data) throws -> Data {
    guard let key else { return plaintext }
    guard n < maxNonce else { throw NoiseError.nonceExhausted }
    let nonce = try ChaChaPoly.Nonce(data: nonceBytes(n))
    let box = try ChaChaPoly.seal(plaintext, using: key, nonce: nonce, authenticating: ad)
    n += 1
    // Noise frames are ciphertext‖tag; CryptoKit keeps them apart.
    return box.ciphertext + box.tag
  }

  func decryptWithAd(_ ad: Data, _ ciphertext: Data) throws -> Data {
    guard let key else { return ciphertext }
    guard n < maxNonce else { throw NoiseError.nonceExhausted }
    guard ciphertext.count >= tagLen else { throw NoiseError.truncatedMessage }
    let nonce = try ChaChaPoly.Nonce(data: nonceBytes(n))
    let split = ciphertext.count - tagLen
    let box = try ChaChaPoly.SealedBox(
      nonce: nonce,
      ciphertext: ciphertext.prefix(split),
      tag: ciphertext.suffix(tagLen)
    )
    do {
      let pt = try ChaChaPoly.open(box, using: key, authenticating: ad)
      n += 1
      return pt
    } catch {
      throw NoiseError.decryptionFailed
    }
  }
}

final class SymmetricState {
  private var ck: Data
  private var h: Data
  let cipher = CipherState()

  init(protocolName: String) {
    let name = Data(protocolName.utf8)
    if name.count <= hashLen {
      var padded = Data(repeating: 0, count: hashLen)
      padded.replaceSubrange(0..<name.count, with: name)
      h = padded
    } else {
      h = Data(SHA256.hash(data: name))
    }
    ck = h
  }

  func mixKey(_ ikm: Data) {
    let out = noiseHKDF(chainingKey: ck, ikm: ikm, num: 2)
    ck = out[0]
    cipher.initializeKey(out[1].prefix(32))
  }

  func mixHash(_ data: Data) {
    h = Data(SHA256.hash(data: h + data))
  }

  func mixKeyAndHash(_ ikm: Data) {
    let out = noiseHKDF(chainingKey: ck, ikm: ikm, num: 3)
    ck = out[0]
    mixHash(out[1])
    cipher.initializeKey(out[2].prefix(32))
  }

  func encryptAndHash(_ plaintext: Data) throws -> Data {
    let ct = try cipher.encryptWithAd(h, plaintext)
    mixHash(ct)
    return ct
  }

  func decryptAndHash(_ ciphertext: Data) throws -> Data {
    let pt = try cipher.decryptWithAd(h, ciphertext)
    mixHash(ciphertext)
    return pt
  }

  var handshakeHash: Data { h }

  func split() -> (CipherState, CipherState) {
    let out = noiseHKDF(chainingKey: ck, ikm: Data(), num: 2)
    let c1 = CipherState()
    let c2 = CipherState()
    c1.initializeKey(out[0].prefix(32))
    c2.initializeKey(out[1].prefix(32))
    return (c1, c2)
  }
}

public struct NoiseHandshakeConfig {
  public var role: NoiseRole
  public var staticKey: NoiseKeypair
  /// Responder's static public key — required for the initiator (IK pre-message).
  public var remoteStatic: Data?
  /// 32-byte pre-shared key; enables the psk1 variant when present (pairing).
  public var psk: Data?
  public var prologue: Data?
  /// Test hook: force the ephemeral keypair instead of generating one.
  public var ephemeral: NoiseKeypair?

  public init(
    role: NoiseRole,
    staticKey: NoiseKeypair,
    remoteStatic: Data? = nil,
    psk: Data? = nil,
    prologue: Data? = nil,
    ephemeral: NoiseKeypair? = nil
  ) {
    self.role = role
    self.staticKey = staticKey
    self.remoteStatic = remoteStatic
    self.psk = psk
    self.prologue = prologue
    self.ephemeral = ephemeral
  }
}

private let protocolIK = "Noise_IK_25519_ChaChaPoly_SHA256"
private let protocolIKpsk1 = "Noise_IKpsk1_25519_ChaChaPoly_SHA256"

/// Established transport: two independent, nonce-counted cipher directions.
public final class NoiseSession {
  private let send: CipherState
  private let recv: CipherState

  init(send: CipherState, recv: CipherState) throws {
    // A post-split transport always has keys; a nil key here would silently
    // transmit cleartext, so fail loudly instead of degrading.
    guard send.hasKey, recv.hasKey else { throw NoiseError.sessionWithoutKeys }
    self.send = send
    self.recv = recv
  }

  public func encrypt(_ plaintext: Data) throws -> Data {
    try send.encryptWithAd(Data(), plaintext)
  }

  public func decrypt(_ ciphertext: Data) throws -> Data {
    try recv.decryptWithAd(Data(), ciphertext)
  }
}

/// One handshake direction of the two-message IK exchange.
public final class NoiseHandshake {
  private let sym: SymmetricState
  private let initiator: Bool
  private let s: NoiseKeypair
  private let psk: Data?
  private var e: NoiseKeypair?
  private var rs: Data?
  private var re: Data?
  private var messageIndex = 0
  private var transport: (send: CipherState, recv: CipherState)?
  private var hHash: Data?

  public init(_ cfg: NoiseHandshakeConfig) throws {
    initiator = cfg.role == .initiator
    s = cfg.staticKey
    psk = cfg.psk
    e = cfg.ephemeral
    rs = cfg.remoteStatic
    if initiator && rs == nil { throw NoiseError.missingRemoteStatic }

    sym = SymmetricState(protocolName: psk != nil ? protocolIKpsk1 : protocolIK)
    sym.mixHash(cfg.prologue ?? Data())
    // Pre-message `<- s`: both sides mix the responder's static public key.
    sym.mixHash(initiator ? rs! : s.pub)
  }

  private func ephemeral() -> NoiseKeypair {
    if let e { return e }
    let fresh = NoiseCrypto.generateKeypair()
    e = fresh
    return fresh
  }

  private func mixDh(_ a: NoiseKeypair, _ b: Data) throws {
    sym.mixKey(try NoiseCrypto.dh(a, b))
  }

  /// Tokens for message N (0-indexed): msg0 initiator→responder, msg1 back.
  private func tokens(_ index: Int) -> [String] {
    if index == 0 {
      return psk != nil ? ["e", "es", "s", "ss", "psk"] : ["e", "es", "s", "ss"]
    }
    return ["e", "ee", "se"]
  }

  public var isComplete: Bool { transport != nil }

  public func handshakeHash() throws -> Data {
    guard let hHash else { throw NoiseError.handshakeIncomplete }
    return hHash
  }

  /// Initiator's transmitted static, learned and pinned by the responder.
  public func remoteStaticKey() throws -> Data {
    guard let rs else { throw NoiseError.missingRemoteStatic }
    return rs
  }

  private func applyDhToken(_ token: String) throws {
    switch token {
    case "ee":
      try mixDh(ephemeral(), re!)
    case "es":
      if initiator { try mixDh(ephemeral(), rs!) } else { try mixDh(s, re!) }
    case "se":
      if initiator { try mixDh(s, re!) } else { try mixDh(ephemeral(), rs!) }
    case "ss":
      try mixDh(s, rs!)
    case "psk":
      sym.mixKeyAndHash(psk!)
    default:
      break
    }
  }

  public func writeMessage(_ payload: Data) throws -> Data {
    let isWriter =
      (messageIndex == 0 && initiator) || (messageIndex == 1 && !initiator)
    guard isWriter else { throw NoiseError.notYourTurn }

    var buf = Data()
    for token in tokens(messageIndex) {
      switch token {
      case "e":
        let e = ephemeral()
        buf += e.pub
        sym.mixHash(e.pub)
        if psk != nil { sym.mixKey(e.pub) }
      case "s":
        buf += try sym.encryptAndHash(s.pub)
      default:
        try applyDhToken(token)
      }
    }
    buf += try sym.encryptAndHash(payload)
    try finishMessage()
    return buf
  }

  public func readMessage(_ message: Data) throws -> Data {
    let isReader =
      (messageIndex == 0 && !initiator) || (messageIndex == 1 && initiator)
    guard isReader else { throw NoiseError.notYourTurn }

    var rest = Data(message)
    for token in tokens(messageIndex) {
      switch token {
      case "e":
        guard rest.count >= dhLen else { throw NoiseError.truncatedMessage }
        re = rest.prefix(dhLen)
        rest = rest.dropFirst(dhLen)
        sym.mixHash(re!)
        if psk != nil { sym.mixKey(re!) }
      case "s":
        let len = sym.cipher.hasKey ? dhLen + tagLen : dhLen
        guard rest.count >= len else { throw NoiseError.truncatedMessage }
        rs = try sym.decryptAndHash(rest.prefix(len))
        rest = rest.dropFirst(len)
      default:
        try applyDhToken(token)
      }
    }
    let payload = try sym.decryptAndHash(rest)
    try finishMessage()
    return payload
  }

  private func finishMessage() throws {
    messageIndex += 1
    guard messageIndex == 2 else { return }
    let (c1, c2) = sym.split()
    hHash = sym.handshakeHash
    // c1 encrypts initiator→responder; c2 the reverse.
    transport = initiator ? (send: c1, recv: c2) : (send: c2, recv: c1)
  }

  public func session() throws -> NoiseSession {
    guard let transport else { throw NoiseError.handshakeIncomplete }
    return try NoiseSession(send: transport.send, recv: transport.recv)
  }
}
