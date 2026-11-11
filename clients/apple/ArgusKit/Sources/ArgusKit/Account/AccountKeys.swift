import CryptoKit
import Foundation

/// This install's account identity: one Ed25519 key that signs log entries and
/// one X25519 Noise key it dials every account host with.
public struct AccountDeviceKeys: Codable, Hashable, Sendable {
  public var memberId: String
  /// The 32-byte Ed25519 seed, standard base64.
  public var signSeed: String
  public var signPub: String
  public var noisePriv: String
  public var noisePub: String
  /// `ios` or `mac`.
  public var kind: String
  public var name: String
  public var createdAt: Double

  public init(
    memberId: String, signSeed: String, signPub: String, noisePriv: String, noisePub: String,
    kind: String, name: String, createdAt: Double
  ) {
    self.memberId = memberId
    self.signSeed = signSeed
    self.signPub = signPub
    self.noisePriv = noisePriv
    self.noisePub = noisePub
    self.kind = kind
    self.name = name
    self.createdAt = createdAt
  }

  public static func generate(kind: String, name: String, now: Date = Date()) -> AccountDeviceKeys {
    let sign = Curve25519.Signing.PrivateKey()
    let noise = NoiseCrypto.generateKeypair()
    return AccountDeviceKeys(
      memberId: UUID().uuidString.lowercased(),
      signSeed: AccountCodec.b64(sign.rawRepresentation),
      signPub: AccountCodec.b64(sign.publicKey.rawRepresentation),
      noisePriv: AccountCodec.b64(noise.priv),
      noisePub: AccountCodec.b64(noise.pub),
      kind: kind,
      name: Self.memberName(name),
      createdAt: (now.timeIntervalSince1970 * 1000).rounded())
  }

  /// A device name the log accepts: 1–64 UTF-16 units, no control characters.
  public static func memberName(_ raw: String) -> String {
    var name = String(raw.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f }.map(Character.init))
      .trimmingCharacters(in: .whitespaces)
    while name.utf16.count > 64 { name.removeLast() }
    return name.isEmpty ? "Device" : name
  }

  /// A name typed into a "Name" setting: trimmed, then 1–64 UTF-16 units with
  /// no control characters; nil otherwise. Mirrors the TS `normalizeMemberName`.
  public static func validatedName(_ raw: String) -> String? {
    let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return AccountBody.validName(name) ? name : nil
  }

  public var member: AccountMember {
    .device(id: memberId, kind: kind, signPub: signPub, noisePub: noisePub, name: name, createdAt: createdAt)
  }

  public var signer: AccountSigner? {
    AccountCodec.fromB64(signSeed).map { AccountSigner(id: memberId, seed: $0) }
  }

  public var noiseKeypair: NoiseKeypair? {
    guard let priv = AccountCodec.fromB64(noisePriv), let pub = AccountCodec.fromB64(noisePub) else {
      return nil
    }
    return NoiseKeypair(priv: priv, pub: pub)
  }
}

/// Where a host was last seen, kept so an offline host still has addresses to try.
public struct AccountCachedPresence: Codable, Hashable, Sendable {
  public var ts: Double
  public var lastSeen: Double
  public var endpoints: [RemoteEndpoint]

  public init(ts: Double, lastSeen: Double, endpoints: [RemoteEndpoint]) {
    self.ts = ts
    self.lastSeen = lastSeen
    self.endpoints = endpoints
  }
}

/// A join request this device filed and hasn't seen settled yet.
public struct AccountPendingJoin: Codable, Hashable, Sendable {
  public var requestId: String
  public var accountId: String
  public var epoch: Int

  public init(requestId: String, accountId: String, epoch: Int) {
    self.requestId = requestId
    self.accountId = accountId
    self.epoch = epoch
  }
}

/// Everything account-related this device keeps between launches.
public struct AccountVault: Codable, Hashable, Sendable {
  public var keys: AccountDeviceKeys?
  /// The account this device trusts, pinned at genesis or on resume.
  public var root: AccountRoot?
  /// The verified log, so a launch re-verifies offline and fetches only what's new.
  public var entries: [AccountEntry]
  public var presence: [String: AccountCachedPresence]
  /// The Mac app's bundled host, once linked to the account.
  public var localHostId: String?
  /// The join request whose code this device confirmed, and that code's
  /// commit: the only approval it adopts before it has pinned the account.
  public var joinRequestId: String?
  public var joinCommit: String?
  /// The join request this device is waiting on, so a relaunch resumes it
  /// instead of filing another.
  public var pendingJoin: AccountPendingJoin?
  /// A name set here that isn't on the account yet (offline, or mid-join).
  public var pendingName: String?
  /// The sign-in session was lost with these keys still on the account: signing in
  /// again as the same person resumes them instead of asking to join from scratch.
  public var signedOut: Bool?

  public init(
    keys: AccountDeviceKeys? = nil, root: AccountRoot? = nil, entries: [AccountEntry] = [],
    presence: [String: AccountCachedPresence] = [:], localHostId: String? = nil,
    joinRequestId: String? = nil, joinCommit: String? = nil, pendingJoin: AccountPendingJoin? = nil,
    pendingName: String? = nil
  ) {
    self.keys = keys
    self.root = root
    self.entries = entries
    self.presence = presence
    self.localHostId = localHostId
    self.joinRequestId = joinRequestId
    self.joinCommit = joinCommit
    self.pendingJoin = pendingJoin
    self.pendingName = pendingName
  }

  public static let empty = AccountVault()
}

public protocol AccountVaultStore: Sendable {
  func load() async -> AccountVault
  func save(_ vault: AccountVault) async
}

/// The vault in the Keychain, beside the pairings: this device only, never synced.
public struct KeychainAccountVault: AccountVaultStore {
  private let keystore: Keystore
  private let item: String

  public init(keystore: Keystore = Keystore(), item: String = "argus.account") {
    self.keystore = keystore
    self.item = item
  }

  public func load() async -> AccountVault {
    guard let data = await keystore.readItem(item),
      let vault = try? JSONDecoder().decode(AccountVault.self, from: data)
    else { return .empty }
    return vault
  }

  public func save(_ vault: AccountVault) async {
    if vault == .empty {
      await keystore.deleteItem(item)
      return
    }
    guard let data = try? JSONEncoder().encode(vault) else { return }
    await keystore.writeItem(data, account: item)
  }
}

/// For tests and previews.
public actor MemoryAccountVault: AccountVaultStore {
  public private(set) var vault: AccountVault

  public init(_ vault: AccountVault = .empty) {
    self.vault = vault
  }

  public func load() async -> AccountVault { vault }
  public func save(_ vault: AccountVault) async { self.vault = vault }
}
