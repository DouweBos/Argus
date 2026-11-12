import Foundation

/// How a request proves who sent it.
enum AccountRequestAuth: Equatable {
  case none
  /// Clerk only: genesis, asking to join, reset. Proves the person, not a device.
  case identity
  /// The member key while this device is a live member, Clerk before that.
  case member
}

/// Set once a service refused a device's signature but took Clerk.
final class ClerkFallback: @unchecked Sendable {
  private let lock = NSLock()
  private var used = false
  var onFirstUse: @Sendable () -> Void = {}

  var active: Bool { lock.withLock { used } }

  func use() {
    let first = lock.withLock {
      defer { used = true }
      return !used
    }
    if first { onFirstUse() }
  }
}

extension AccountClient {
  struct Empty: Decodable {}

  /// The service's signature window is five minutes; past four, blame the clock.
  static let clockSkewLimit: TimeInterval = 4 * 60

  func send<Result: Decodable>(
    _ method: String, _ path: String, query: [(String, String)] = [], auth: AccountRequestAuth = .member
  ) async throws -> Result {
    try await send(method, path, query: query, auth: auth, bodyData: nil)
  }

  func send<Result: Decodable>(
    _ method: String, _ path: String, query: [(String, String)] = [], auth: AccountRequestAuth = .member,
    body: some Encodable
  ) async throws -> Result {
    try await send(method, path, query: query, auth: auth, bodyData: try JSONEncoder().encode(body))
  }

  private func send<Result: Decodable>(
    _ method: String, _ path: String, query: [(String, String)], auth: AccountRequestAuth, bodyData: Data?
  ) async throws -> Result {
    var components = URLComponents(
      url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
    if !query.isEmpty { components?.queryItems = query.map { URLQueryItem(name: $0.0, value: $0.1) } }
    guard let url = components?.url else { throw AccountServiceError.transport("bad URL") }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 20
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let bodyData {
      request.httpBody = bodyData
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    switch auth {
    case .none:
      return try decode(await perform(request))
    case .member where !fallback.active:
      if let signer = await signer() {
        return try await sendSigned(request, signer: signer)
      }
      fallthrough
    case .identity, .member:
      return try decode(await perform(try await bearer(request)))
    }
  }

  private func sendSigned<Result: Decodable>(_ request: URLRequest, signer: AccountSigner) async throws -> Result {
    let response = try await perform(try sign(request, with: signer))
    guard [401, 403].contains(response.1.statusCode) else { return try decode(response) }
    // A service from before device-key auth only takes Clerk from a device: retry with it
    // and keep using it this launch. Remove this fallback once every service accepts device members.
    if let token = try? await token(), !token.isEmpty {
      var retry = request
      retry.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      let answer = try await perform(retry)
      if (200..<300).contains(answer.1.statusCode) { fallback.use() }
      return try decode(answer)
    }
    if clockSkewed(response.1) { throw AccountServiceError.clockSkew }
    throw AccountServiceError.memberRefused(status: response.1.statusCode)
  }

  /// `x-argus-member` / `-ts` / `-sig` over `requestSigningBytes`, as hosts sign.
  func sign(_ request: URLRequest, with signer: AccountSigner) throws -> URLRequest {
    guard let url = request.url else { throw AccountServiceError.transport("bad URL") }
    let ts = Int64((now().timeIntervalSince1970 * 1000).rounded())
    var pathAndQuery = url.path(percentEncoded: true)
    if let query = url.query(percentEncoded: true) { pathAndQuery += "?\(query)" }
    let message = AccountCodec.requestSigningBytes(
      method: request.httpMethod ?? "GET", pathAndQuery: pathAndQuery, ts: ts, body: request.httpBody ?? Data())
    var signed = request
    signed.setValue(signer.id, forHTTPHeaderField: "x-argus-member")
    signed.setValue(String(ts), forHTTPHeaderField: "x-argus-ts")
    signed.setValue(try AccountCodec.sign(message, seed: signer.seed), forHTTPHeaderField: "x-argus-sig")
    return signed
  }

  private func bearer(_ request: URLRequest) async throws -> URLRequest {
    guard let token = try await token(), !token.isEmpty else { throw AccountServiceError.notSignedIn }
    var authed = request
    authed.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    return authed
  }

  private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    do {
      return try await http(request)
    } catch let error as AccountServiceError {
      throw error
    } catch {
      throw AccountServiceError.transport(error.localizedDescription)
    }
  }

  private func decode<Result: Decodable>(_ answer: (Data, HTTPURLResponse)) throws -> Result {
    let (data, response) = answer
    guard (200..<300).contains(response.statusCode) else {
      throw AccountServiceError.from(status: response.statusCode, data: data)
    }
    if Result.self == Empty.self { return Empty() as! Result }
    do {
      return try JSONDecoder().decode(Result.self, from: data.isEmpty ? Data("{}".utf8) : data)
    } catch {
      throw AccountServiceError.decoding
    }
  }

  /// The service's `Date` is far from ours: a refused signature is the clock, not a removal.
  func clockSkewed(_ response: HTTPURLResponse) -> Bool {
    guard let header = response.value(forHTTPHeaderField: "Date"),
      let served = Self.httpDate.date(from: header)
    else { return false }
    return abs(served.timeIntervalSince(now())) > Self.clockSkewLimit
  }

  private static let httpDate: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "GMT")
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    return formatter
  }()
}

public enum AccountServiceError: Error, Equatable, Sendable {
  case notSignedIn
  /// The service refused this device's own signature: removed from the account
  /// (401), or a service that doesn't take device keys yet with no Clerk to fall back on.
  case memberRefused(status: Int)
  /// A signature refused while this device's clock is off by minutes.
  case clockSkew
  /// This device's epoch is over: the account was reset (`410 account_reset`).
  case accountReset(epoch: Int, genesis: AccountEntry?)
  /// The log moved on underneath an append.
  case conflict(headSeq: Int?)
  case invalidEntry(index: Int?, reason: String?)
  case http(status: Int, code: String?)
  case transport(String)
  case decoding

  static func from(status: Int, data: Data) -> AccountServiceError {
    struct Payload: Decodable {
      let error: String?
      let headSeq: Int?
      let index: Int?
      let reason: String?
      let epoch: Int?
      let genesis: AccountEntry?
      enum CodingKeys: String, CodingKey {
        case error, index, reason, epoch, genesis
        case headSeq = "head_seq"
      }
    }
    let payload = try? JSONDecoder().decode(Payload.self, from: data)
    switch (status, payload?.error) {
    case (401, _): return .notSignedIn
    case (409, _): return .conflict(headSeq: payload?.headSeq)
    case (410, "account_reset"):
      guard let epoch = payload?.epoch else { return .http(status: status, code: "account_reset") }
      return .accountReset(epoch: epoch, genesis: payload?.genesis)
    case (422, _): return .invalidEntry(index: payload?.index, reason: payload?.reason)
    default: return .http(status: status, code: payload?.error)
    }
  }

  public var message: String {
    switch self {
    case .notSignedIn: "You're signed out. Sign in again."
    case .memberRefused(401): "This device was removed from your account."
    case .memberRefused: "The account service doesn't accept this device yet. Sign in again."
    case .clockSkew: "This device's clock is off, so the account service refused it. Check the date and time."
    case .accountReset: "Your account was reset."
    case .conflict: "Your account changed at the same time. Try again."
    case .invalidEntry: "The account service refused the change."
    case .http(410, _): "That code has expired. Start again on the computer."
    case .http(404, _): "That code wasn't found. Check it and try again."
    case .http(429, _): "Too many attempts. Wait a few minutes and try again."
    case .http(let status, _): "The account service answered \(status)."
    case .transport: "Couldn't reach the account service."
    case .decoding: "The account service's answer couldn't be read."
    }
  }
}
