import Foundation

/// A device's side of the account service (`houwert.dev/argus/account/v1`).
/// It only ever carries signed statements and public keys; nothing it returns
/// is trusted until the log verifier has seen it.
///
/// A live member signs its requests with its own key; the Clerk session only
/// proves who you are, for the identity routes (genesis, joining, reset).
public struct AccountClient: Sendable {
  public typealias HTTP = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
  public typealias TokenProvider = @Sendable () async throws -> String?
  /// This device's member key while it is a live member, else nil (Clerk then).
  public typealias SignerProvider = @Sendable () async -> AccountSigner?

  public static let defaultBaseURL = URL(string: "https://houwert.dev/argus/account/v1")!
  /// `ARGUS_ACCOUNT_URL` in the environment, else this defaults key, else the built-in service.
  public static let baseURLDefaultsKey = "argus.account.url"

  public let baseURL: URL
  let token: TokenProvider
  let signer: SignerProvider
  let http: HTTP
  let now: @Sendable () -> Date
  let fallback = ClerkFallback()

  /// - Parameter onClerkFallback: the service refused this device's signature and
  ///   took Clerk instead, so it predates device-key auth; once per launch.
  public init(
    baseURL: URL = AccountClient.configuredBaseURL(), token: @escaping TokenProvider,
    signer: @escaping SignerProvider = { nil }, http: HTTP? = nil,
    now: @escaping @Sendable () -> Date = Date.init,
    onClerkFallback: @escaping @Sendable () -> Void = {}
  ) {
    self.baseURL = baseURL
    self.token = token
    self.signer = signer
    self.http = http ?? AccountClient.urlSession
    self.now = now
    fallback.onFirstUse = onClerkFallback
  }

  /// This launch found a service that only takes Clerk from devices.
  public var usesClerkForMembers: Bool { fallback.active }

  public static func configuredBaseURL(
    environment: [String: String] = ProcessInfo.processInfo.environment, defaults: UserDefaults = .standard
  ) -> URL {
    for raw in [environment["ARGUS_ACCOUNT_URL"], defaults.string(forKey: baseURLDefaultsKey)] {
      if let raw, !raw.isEmpty, let url = URL(string: raw) { return url }
    }
    return defaultBaseURL
  }

  static let urlSession: HTTP = { request in
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw AccountServiceError.transport("no HTTP response") }
    return (data, http)
  }

  // MARK: Routes

  public func config() async throws -> AccountServiceConfig {
    try await send("GET", "config", auth: .none)
  }

  /// Create-or-get the signed-in user's account.
  public func account() async throws -> AccountInfo {
    try await send("POST", "account", auth: .identity, body: [String: String]())
  }

  /// Every entry after `after` (−1 for the whole log), following pages.
  public func log(epoch: Int, after: Int) async throws -> [AccountEntry] {
    var entries: [AccountEntry] = []
    var cursor = after
    while true {
      let page: AccountLogPage = try await send(
        "GET", "log", query: [("epoch", "\(epoch)"), ("after", "\(cursor)")])
      entries += page.entries
      guard let next = page.nextAfter, next > cursor, !page.entries.isEmpty else { return entries }
      cursor = next
    }
  }

  /// Append a batch; the service checks it extends the head (409 otherwise).
  @discardableResult
  public func append(epoch: Int, entries: [AccountEntry]) async throws -> Int {
    struct Body: Encodable {
      let epoch: Int
      let entries: [AccountEntry]
    }
    struct Result: Decodable {
      let headSeq: Int
      enum CodingKeys: String, CodingKey { case headSeq = "head_seq" }
    }
    let result: Result = try await send("POST", "log", body: Body(epoch: epoch, entries: entries))
    return result.headSeq
  }

  /// Start the account over at `epoch` (current + 1) from this device's genesis (§5.8).
  /// Needs a session reverified within 10 minutes (`403` otherwise).
  @discardableResult
  public func resetAccount(epoch: Int, entries: [AccountEntry]) async throws -> AccountInfo {
    struct Body: Encodable {
      let epoch: Int
      let entries: [AccountEntry]
    }
    return try await send("POST", "account/reset", auth: .identity, body: Body(epoch: epoch, entries: entries))
  }

  public func directory() async throws -> [AccountDirectoryRecord] {
    struct Result: Decodable { let hosts: [AccountDirectoryRecord] }
    let result: Result = try await send("GET", "directory")
    return result.hosts
  }

  /// Bind a host's link code to this account.
  public func claim(userCode: String) async throws -> AccountLinkClaim {
    struct Body: Encodable {
      let userCode: String
      enum CodingKeys: String, CodingKey { case userCode = "user_code" }
    }
    return try await send("POST", "link/claim", body: Body(userCode: userCode))
  }

  /// Ask to join the signed-in account as `member` (§5.4).
  public func join(member: AccountMember, proof: String) async throws -> AccountJoinTicket {
    struct Body: Encodable {
      let member: AccountMember
      let proof: String
    }
    return try await send("POST", "join", auth: .identity, body: Body(member: member, proof: proof))
  }

  /// Where this device's own join request is.
  public func joinStatus(requestId: String) async throws -> AccountRequestStatus {
    try await send("GET", "join/\(requestId)")
  }

  public func joinRequests() async throws -> [AccountJoinRequestInfo] {
    struct Result: Decodable { let requests: [AccountJoinRequestInfo] }
    let result: Result = try await send("GET", "join")
    return result.requests
  }

  /// Become a request's approver; returns the head the SAS binds.
  public func approve(requestId: String, approverId: String) async throws -> AccountHead {
    struct Body: Encodable {
      let approverId: String
      enum CodingKeys: String, CodingKey { case approverId = "approver_id" }
    }
    struct Result: Decodable { let head: AccountHead }
    let result: Result = try await send(
      "POST", "join/\(requestId)/approver", body: Body(approverId: approverId))
    return result.head
  }

  /// Register this device's push token and its per-host sealed keys (phase 3).
  public func registerPush(_ registration: AccountPushRegistration) async throws {
    let _: Empty = try await send("PUT", "push/registration", body: registration)
  }

  /// Push was switched off on this device.
  public func unregisterPush(deviceId: String) async throws {
    let _: Empty = try await send("DELETE", "push/registration", body: ["device_id": deviceId])
  }

  public func deny(requestId: String) async throws {
    let _: Empty = try await send("POST", "join/\(requestId)/deny", body: [String: String]())
  }
}

public struct AccountServiceConfig: Decodable, Sendable {
  public var clerkPublishableKey: String
  public var frontendApi: String?
  public var minClient: [String: String]?

  enum CodingKeys: String, CodingKey {
    case clerkPublishableKey = "clerk_publishable_key"
    case frontendApi = "frontend_api"
    case minClient = "min_client"
  }

  public init(clerkPublishableKey: String, frontendApi: String? = nil, minClient: [String: String]? = nil) {
    self.clerkPublishableKey = clerkPublishableKey
    self.frontendApi = frontendApi
    self.minClient = minClient
  }
}

public struct AccountInfo: Codable, Equatable, Sendable {
  public var accountId: String
  public var epoch: Int
  /// Nil for an account with no log yet.
  public var headSeq: Int?

  enum CodingKeys: String, CodingKey {
    case accountId = "account_id"
    case epoch
    case headSeq = "head_seq"
  }

  public init(accountId: String, epoch: Int, headSeq: Int?) {
    self.accountId = accountId
    self.epoch = epoch
    self.headSeq = headSeq
  }
}

struct AccountLogPage: Decodable {
  var epoch: Int
  var entries: [AccountEntry]
  var nextAfter: Int?

  enum CodingKeys: String, CodingKey {
    case epoch, entries
    case nextAfter = "next_after"
  }
}

/// Who a link request is for: the host, an Electron window riding along, and
/// each one's proof of possession.
public struct AccountLinkSubject: Codable, Hashable, Sendable {
  public var host: AccountMember
  public var device: AccountMember?
  public var proofs: [String: String]

  public init(host: AccountMember, device: AccountMember? = nil, proofs: [String: String]) {
    self.host = host
    self.device = device
    self.proofs = proofs
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    host = try c.decode(AccountMember.self, forKey: .host)
    device = try c.decodeIfPresent(AccountMember.self, forKey: .device)
    proofs = try c.decodeIfPresent([String: String].self, forKey: .proofs) ?? [:]
  }
}

public struct AccountLinkClaim: Decodable, Sendable {
  public var requestId: String
  /// `host`, or `computer` when an Electron window rides along.
  public var kind: String
  public var subject: AccountLinkSubject
  public var accountEmpty: Bool

  enum CodingKeys: String, CodingKey {
    case requestId = "request_id"
    case kind, subject, proofs
    case accountEmpty = "account_empty"
  }

  public init(requestId: String, kind: String, subject: AccountLinkSubject, accountEmpty: Bool) {
    self.requestId = requestId
    self.kind = kind
    self.subject = subject
    self.accountEmpty = accountEmpty
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    requestId = try c.decode(String.self, forKey: .requestId)
    kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "host"
    subject = try c.decode(AccountLinkSubject.self, forKey: .subject)
    // Proofs belong in `subject`; accept them beside it too.
    if subject.proofs.isEmpty, let proofs = try c.decodeIfPresent([String: String].self, forKey: .proofs) {
      subject.proofs = proofs
    }
    accountEmpty = try c.decodeIfPresent(Bool.self, forKey: .accountEmpty) ?? false
  }
}

/// Who a pending request is for: a computer (with an Electron window riding
/// along), or a device that signed in. Each with its proof of possession.
public struct AccountRequestSubject: Codable, Hashable, Sendable {
  public var host: AccountMember?
  public var device: AccountMember?
  public var proofs: [String: String]

  public init(host: AccountMember? = nil, device: AccountMember? = nil, proofs: [String: String]) {
    self.host = host
    self.device = device
    self.proofs = proofs
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    host = try c.decodeIfPresent(AccountMember.self, forKey: .host)
    device = try c.decodeIfPresent(AccountMember.self, forKey: .device)
    proofs = try c.decodeIfPresent([String: String].self, forKey: .proofs) ?? [:]
  }

  /// The member the code is about: the computer of a link, else the device.
  public var member: AccountMember? { host ?? device }

  /// Every member's own key vouches for it; nothing unproven is shown.
  public var proven: Bool {
    let members = [host, device].compactMap { $0 }
    return !members.isEmpty
      && members.allSatisfy { m in
        proofs[m.id].map { AccountCodec.verify(m.proofBytes, signature: $0, publicKey: m.signPub) } ?? false
      }
  }
}

public struct AccountJoinTicket: Decodable, Sendable, Equatable {
  public var requestId: String
  public var expiresAt: Double

  enum CodingKeys: String, CodingKey {
    case requestId = "request_id"
    case expiresAt = "expires_at"
  }
}

/// `GET /join/:id`: untrusted, only tells the joining device whom to compare with.
public struct AccountRequestStatus: Decodable, Sendable, Equatable {
  public struct Approver: Decodable, Sendable, Equatable {
    public var id: String
    public var signPub: String

    enum CodingKeys: String, CodingKey {
      case id
      case signPub = "sign_pub"
    }
  }

  public var status: String
  public var accountId: String?
  public var epoch: Int?
  public var approver: Approver?
  public var head: AccountHead?
  public var throughSeq: Int?

  enum CodingKeys: String, CodingKey {
    case status, epoch, approver, head
    case accountId = "account_id"
    case throughSeq = "through_seq"
  }
}

public struct AccountJoinRequestInfo: Decodable, Sendable, Identifiable, Equatable {
  public var requestId: String
  public var kind: String
  public var subject: AccountRequestSubject?
  public var status: String
  public var createdAt: Double?
  public var expiresAt: Double?

  public var id: String { requestId }

  public init(
    requestId: String, kind: String, subject: AccountRequestSubject?, status: String = "claimed",
    createdAt: Double? = nil, expiresAt: Double? = nil
  ) {
    self.requestId = requestId
    self.kind = kind
    self.subject = subject
    self.status = status
    self.createdAt = createdAt
    self.expiresAt = expiresAt
  }

  enum CodingKeys: String, CodingKey {
    case requestId = "request_id"
    case kind, subject, status
    case createdAt = "created_at"
    case expiresAt = "expires_at"
  }

  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    requestId = try c.decode(String.self, forKey: .requestId)
    kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "host"
    subject = try? c.decodeIfPresent(AccountRequestSubject.self, forKey: .subject)
    status = try c.decodeIfPresent(String.self, forKey: .status) ?? "claimed"
    createdAt = try? c.decodeIfPresent(Double.self, forKey: .createdAt)
    expiresAt = try? c.decodeIfPresent(Double.self, forKey: .expiresAt)
  }
}
