import Foundation

/// A device or host on the account, as its log entry names it.
public struct AccountMember: Codable, Hashable, Sendable, Identifiable {
  public enum Role: String, Codable, Sendable {
    case device, host
  }

  public var id: String
  public var role: Role
  /// `ios` / `mac` / `electron`, for a device.
  public var kind: String?
  /// `darwin` / `linux`, for a host.
  public var platform: String?
  /// Ed25519, standard base64.
  public var signPub: String
  /// X25519 Noise static key, standard base64 — what a client pins.
  public var noisePub: String
  public var name: String
  public var createdAt: Double

  enum CodingKeys: String, CodingKey {
    case id, role, kind, platform, name
    case signPub = "sign_pub"
    case noisePub = "noise_pub"
    case createdAt = "created_at"
  }

  public init(
    id: String, role: Role, kind: String? = nil, platform: String? = nil, signPub: String,
    noisePub: String, name: String, createdAt: Double
  ) {
    self.id = id
    self.role = role
    self.kind = kind
    self.platform = platform
    self.signPub = signPub
    self.noisePub = noisePub
    self.name = name
    self.createdAt = createdAt
  }

  public static func device(
    id: String, kind: String, signPub: String, noisePub: String, name: String, createdAt: Double
  ) -> AccountMember {
    AccountMember(
      id: id, role: .device, kind: kind, signPub: signPub, noisePub: noisePub, name: name,
      createdAt: createdAt)
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(role, forKey: .role)
    try c.encodeIfPresent(kind, forKey: .kind)
    try c.encodeIfPresent(platform, forKey: .platform)
    try c.encode(signPub, forKey: .signPub)
    try c.encode(noisePub, forKey: .noisePub)
    try c.encode(name, forKey: .name)
    // Whole milliseconds stay integers, as `Date.now()` writes them.
    if let whole = Int64(exactly: createdAt) {
      try c.encode(whole, forKey: .createdAt)
    } else {
      try c.encode(createdAt, forKey: .createdAt)
    }
  }

  /// The proof-of-possession message this member's key signs.
  public var proofBytes: Data {
    AccountCodec.proofSigningBytes(id: id, role: role.rawValue, signPub: signPub, noisePub: noisePub)
  }
}

/// One log entry exactly as stored and transmitted: the signed body string
/// and its signatures, keyed by member id.
public struct AccountEntry: Codable, Hashable, Sendable {
  public var body: String
  public var sigs: [String: String]

  public init(body: String, sigs: [String: String]) {
    self.body = body
    self.sigs = sigs
  }

  public var hash: String { AccountCodec.entryHash(body) }
}

/// What a verifier pins on first use.
public struct AccountRoot: Codable, Hashable, Sendable {
  public var accountId: String
  public var epoch: Int
  public var genesisHash: String

  enum CodingKeys: String, CodingKey {
    case accountId = "account_id"
    case epoch
    case genesisHash = "genesis_hash"
  }

  public init(accountId: String, epoch: Int, genesisHash: String) {
    self.accountId = accountId
    self.epoch = epoch
    self.genesisHash = genesisHash
  }

  public var safetyCode: String { AccountCodec.safetyCode(genesisHash: genesisHash) }
}

public struct AccountHead: Codable, Hashable, Sendable {
  public var seq: Int
  public var hash: String

  public init(seq: Int, hash: String) {
    self.seq = seq
    self.hash = hash
  }
}

public struct AccountMemberState: Codable, Hashable, Sendable {
  public var member: AccountMember
  public var live: Bool
  /// The request the member joined through; "" for genesis and local links.
  public var requestId: String
  public var sasCommit: String
  /// The member that wrote its `add_*` (itself for genesis).
  public var addedBy: String

  public init(member: AccountMember, live: Bool, requestId: String, sasCommit: String, addedBy: String) {
    self.member = member
    self.live = live
    self.requestId = requestId
    self.sasCommit = sasCommit
    self.addedBy = addedBy
  }
}

/// Everything a verified log says: who is on the account and where its head is.
public struct AccountLogState: Codable, Hashable, Sendable {
  public var accountId: String
  public var epoch: Int
  public var genesisHash: String
  public var head: AccountHead
  public var members: [String: AccountMemberState]

  public init(
    accountId: String, epoch: Int, genesisHash: String, head: AccountHead,
    members: [String: AccountMemberState]
  ) {
    self.accountId = accountId
    self.epoch = epoch
    self.genesisHash = genesisHash
    self.head = head
    self.members = members
  }

  public var root: AccountRoot {
    AccountRoot(accountId: accountId, epoch: epoch, genesisHash: genesisHash)
  }

  public func liveMember(_ id: String) -> AccountMemberState? {
    guard let found = members[id], found.live else { return nil }
    return found
  }

  /// Live members, oldest first.
  public var liveMembers: [AccountMember] {
    members.values.filter(\.live).map(\.member).sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }
  }

  func signKeyInUse(_ signPub: String) -> Bool {
    members.values.contains { $0.member.signPub == signPub }
  }

  /// The subject's own check before adopting a log: it is in it, live, and was
  /// added through the request and code it confirmed.
  public func admits(memberId: String, requestId: String, sasCommit: String) -> Bool {
    guard let found = liveMember(memberId) else { return false }
    return found.requestId == requestId && found.sasCommit == sasCommit
  }
}

public enum AccountLogRejectReason: String, Codable, Sendable, Error {
  case badSignature = "bad_signature"
  case fork
  case malformed
  case unknownSigner = "unknown_signer"
}

public enum AccountVerifyResult: Sendable {
  case ok(AccountLogState)
  /// `state` is the last good state, or nil when nothing verified.
  case rejected(reason: AccountLogRejectReason, index: Int, state: AccountLogState?)

  public var state: AccountLogState? {
    switch self {
    case .ok(let state): state
    case .rejected(_, _, let state): state
    }
  }
}

/// A directory row as the service returns it; untrusted until verified.
public struct AccountDirectoryRecord: Codable, Hashable, Sendable {
  public var hostId: String
  public var presenceBody: String
  public var presenceSig: String
  public var lastSeen: Double

  enum CodingKeys: String, CodingKey {
    case hostId = "host_id"
    case presenceBody = "presence_body"
    case presenceSig = "presence_sig"
    case lastSeen = "last_seen"
  }

  public init(hostId: String, presenceBody: String, presenceSig: String, lastSeen: Double) {
    self.hostId = hostId
    self.presenceBody = presenceBody
    self.presenceSig = presenceSig
    self.lastSeen = lastSeen
  }
}

/// A verified presence record: where a host says it can be reached.
public struct AccountPresence: Hashable, Sendable {
  public var hostId: String
  public var ts: Double
  public var endpoints: [RemoteEndpoint]

  public init(hostId: String, ts: Double, endpoints: [RemoteEndpoint]) {
    self.hostId = hostId
    self.ts = ts
    self.endpoints = endpoints
  }

  /// How long a host may go quiet before it shows as offline.
  public static let onlineWindow: TimeInterval = 15 * 60

  public static func isOnline(lastSeenMs: Double?, now: Date = Date()) -> Bool {
    guard let lastSeenMs else { return false }
    return now.timeIntervalSince1970 * 1000 - lastSeenMs <= onlineWindow * 1000
  }
}
