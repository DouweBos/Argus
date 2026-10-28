import ArgusCore
import Foundation

/// An in-memory account service behind `AccountClient.HTTP`: just enough of
/// the contract's device-side routes, with the same CAS on `POST /log`.
final class FakeAccountService: @unchecked Sendable {
  struct LinkRequest {
    var userCode: String
    var subject: AccountLinkSubject
    var status = "pending"
  }

  private let lock = NSLock()
  private(set) var accountId = "abcdefghijklmnopqrstuvwxyz"
  private(set) var entries: [AccountEntry] = []
  private(set) var appends: [[AccountEntry]] = []
  private var links: [String: LinkRequest] = [:]
  private var directory: [AccountDirectoryRecord] = []
  private var directoryDown = false
  /// Called before a `POST /log` is applied; returning true answers 409 instead.
  var beforeAppend: (@Sendable (FakeAccountService) -> Bool)?

  var log: [AccountEntry] { lock.withLock { entries } }
  var batches: [[AccountEntry]] { lock.withLock { appends } }
  var headHash: String { lock.withLock { entries.last?.hash ?? "" } }

  func seed(_ log: [AccountEntry]) { lock.withLock { entries = log } }

  /// Append outside the API, as another device would.
  func inject(_ entry: AccountEntry) { lock.withLock { entries.append(entry) } }

  func addLink(requestId: String, userCode: String, subject: AccountLinkSubject) {
    lock.withLock { links[requestId] = LinkRequest(userCode: userCode, subject: subject) }
  }

  func linkStatus(_ requestId: String) -> String? { lock.withLock { links[requestId]?.status } }

  func setDirectory(_ records: [AccountDirectoryRecord]) { lock.withLock { directory = records } }

  /// `GET /directory` answers 503 while set.
  func setDirectoryDown(_ down: Bool) { lock.withLock { directoryDown = down } }

  var http: AccountClient.HTTP {
    { [self] request in try handle(request) }
  }

  private func handle(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
    let url = try require(request.url)
    let path = url.path.replacingOccurrences(of: "/argus/account/v1/", with: "")
    let method = request.httpMethod ?? "GET"
    let body = request.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    if path != "config", request.value(forHTTPHeaderField: "Authorization") != "Bearer token" {
      return respond(401, ["error": "unauthorized"], url)
    }
    switch (method, path) {
    case ("GET", "config"):
      return respond(200, ["clerk_publishable_key": "pk_test", "frontend_api": "clerk.example"], url)
    case ("POST", "account"):
      let count = lock.withLock { entries.count }
      let head: Any = count == 0 ? NSNull() : count - 1
      return respond(200, ["account_id": accountId, "epoch": 0, "head_seq": head], url)
    case ("GET", "log"):
      let after = Int(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
        .first { $0.name == "after" }?.value ?? "-1") ?? -1
      let page = lock.withLock { Array(entries.dropFirst(after + 1)) }
      return respond(200, ["epoch": 0, "entries": page.map(Self.json), "next_after": NSNull()], url)
    case ("POST", "log"):
      return appendLog(body, url)
    case ("GET", "directory"):
      if lock.withLock({ directoryDown }) { return respond(503, ["error": "unavailable"], url) }
      let records = lock.withLock { directory }
      return respond(
        200,
        ["hosts": records.map {
          ["host_id": $0.hostId, "presence_body": $0.presenceBody, "presence_sig": $0.presenceSig, "last_seen": $0.lastSeen]
        }], url)
    case ("POST", "link/claim"):
      let code = body["user_code"] as? String ?? ""
      guard let (id, link) = lock.withLock({ links.first { $0.value.userCode == code } }) else {
        return respond(404, ["error": "not_found"], url)
      }
      lock.withLock { links[id]?.status = "claimed" }
      let subject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(link.subject))
      return respond(
        200,
        ["request_id": id, "kind": link.subject.device == nil ? "host" : "computer", "subject": subject,
         "account_empty": lock.withLock { entries.isEmpty }], url)
    case ("POST", _) where path.hasSuffix("/approver"):
      let id = path.split(separator: "/")[1]
      lock.withLock { links[String(id)]?.status = "approving" }
      let head = lock.withLock { ["seq": entries.count - 1, "hash": entries.last?.hash ?? ""] as [String: Any] }
      return respond(200, ["head": head], url)
    case ("POST", _) where path.hasSuffix("/deny"):
      let id = path.split(separator: "/")[1]
      lock.withLock { links[String(id)]?.status = "denied" }
      return respond(204, [:], url)
    default:
      return respond(404, ["error": "not_found"], url)
    }
  }

  private func appendLog(_ body: [String: Any], _ url: URL) -> (Data, HTTPURLResponse) {
    let raw = body["entries"] as? [[String: Any]] ?? []
    let batch = raw.map { AccountEntry(body: $0["body"] as? String ?? "", sigs: $0["sigs"] as? [String: String] ?? [:]) }
    if beforeAppend?(self) == true {
      return respond(409, ["error": "conflict", "head_seq": lock.withLock { entries.count - 1 }], url)
    }
    return lock.withLock {
      guard let first = batch.first,
        let parsed = try? JSONSerialization.jsonObject(with: Data(first.body.utf8)) as? [String: Any],
        parsed["seq"] as? Int == entries.count, parsed["prev"] as? String == (entries.last?.hash ?? "")
      else { return respond(409, ["error": "conflict", "head_seq": entries.count - 1], url) }
      entries += batch
      appends.append(batch)
      for entry in batch {
        if let o = try? JSONSerialization.jsonObject(with: Data(entry.body.utf8)) as? [String: Any],
          let id = o["request_id"] as? String, !id.isEmpty
        {
          links[id]?.status = "approved"
        }
      }
      return respond(201, ["head_seq": entries.count - 1], url)
    }
  }

  static func json(_ entry: AccountEntry) -> [String: Any] { ["body": entry.body, "sigs": entry.sigs] }

  private func respond(_ status: Int, _ object: [String: Any], _ url: URL) -> (Data, HTTPURLResponse) {
    let data = status == 204 ? Data() : (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
    return (data, HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!)
  }
}

private func require<T>(_ value: T?) throws -> T {
  guard let value else { throw URLError(.badURL) }
  return value
}

/// Clerk stand-in: signed in after any sign-in call, with a fixed token.
@MainActor
final class FakeAccountAuth: AccountAuthenticating {
  var signedIn = false
  var configuredKey: String?
  var signedOut = false
  var user: AccountProfile?

  var isSignedIn: Bool { signedIn }
  func configure(publishableKey: String) async throws { configuredKey = publishableKey }
  func signInWithApple(idToken _: String?) async throws { signedIn = true }
  func signInWithGitHub() async throws { signedIn = true }
  func sendEmailCode(_: String) async throws {}
  func verifyEmailCode(_: String) async throws { signedIn = true }
  func token() async throws -> String? { signedIn ? "token" : nil }
  var profile: AccountProfile? { signedIn ? user : nil }
  func signOut() async throws {
    signedIn = false
    signedOut = true
  }
}
