import CryptoKit
import Foundation
import Testing

@testable import ArgusKit

/// Member-signed requests against the TS vector (`request_signing.json`), and
/// which routes go out on the member key, on Clerk, or fall back to it.
@Suite("Account client auth")
struct AccountClientAuthTests {
  struct Vector: Decodable {
    struct Case: Decodable {
      let method: String
      let path_and_query: String
      let ts: Int64
      let body: String
      let message: String
      let sig: String
    }
    let member_id: String
    let sign_pub: String
    let cases: [Case]
  }

  struct Keys: Decodable {
    struct Key: Decodable {
      let id: String
      let sign_priv: String
      let sign_pub: String
    }
    let phone: Key
  }

  static func load<T: Decodable>(_ name: String, as _: T.Type) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(contentsOf: AccountLogTests.fixtures.appendingPathComponent(name)))
  }

  static var phone: AccountSigner {
    get throws {
      let key = try load("keys.json", as: Keys.self).phone
      return AccountSigner(id: key.id, seed: try #require(AccountCodec.fromB64(key.sign_priv)))
    }
  }

  @Test("request signing bytes match the TS vector, byte for byte")
  func signingBytes() throws {
    let vector = try Self.load("request_signing.json", as: Vector.self)
    #expect(vector.cases.count >= 3)
    for c in vector.cases {
      let bytes = AccountCodec.requestSigningBytes(
        method: c.method, pathAndQuery: c.path_and_query, ts: c.ts, body: Data(c.body.utf8))
      #expect(AccountCodec.b64(bytes) == c.message)
      #expect(AccountCodec.verify(bytes, signature: c.sig, publicKey: vector.sign_pub))
    }
  }

  /// Records every request; answers from `respond`.
  final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [URLRequest] = []
    var respond: @Sendable (URLRequest) -> (Int, String) = { _ in (200, "{}") }
    var requests: [URLRequest] { lock.withLock { seen } }

    var http: AccountClient.HTTP {
      { [self] request in
        lock.withLock { seen.append(request) }
        let (status, body) = respond(request)
        return (
          Data(body.utf8),
          HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        )
      }
    }
  }

  final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    var count: Int { lock.withLock { value } }
    func bump() { lock.withLock { value += 1 } }
  }

  func client(_ recorder: Recorder, token: String? = "clerk", signer: AccountSigner?, fallback: @escaping @Sendable () -> Void = {})
    -> AccountClient
  {
    AccountClient(
      baseURL: URL(string: "https://example.test/argus/account/v1")!, token: { token }, signer: { signer },
      http: recorder.http, onClerkFallback: fallback)
  }

  @Test("a live member signs with its key: member id, timestamp, and a signature over the request")
  func memberHeaders() async throws {
    let recorder = Recorder()
    recorder.respond = { _ in (201, #"{"head_seq":0}"#) }
    let signer = try Self.phone
    try await client(recorder, signer: signer).append(epoch: 0, entries: [])
    let request = try #require(recorder.requests.first)
    #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    #expect(request.value(forHTTPHeaderField: "x-argus-member") == signer.id)
    let ts = try #require(request.value(forHTTPHeaderField: "x-argus-ts").flatMap { Int64($0) })
    #expect(abs(Double(ts) / 1000 - Date().timeIntervalSince1970) < 60)
    let message = AccountCodec.requestSigningBytes(
      method: "POST", pathAndQuery: "/argus/account/v1/log", ts: ts, body: try #require(request.httpBody))
    let sig = try #require(request.value(forHTTPHeaderField: "x-argus-sig"))
    #expect(AccountCodec.verify(message, signature: sig, publicKey: try AccountCodec.signingPublicKey(seed: signer.seed)))
  }

  @Test("the query is part of what's signed")
  func querySigned() async throws {
    let recorder = Recorder()
    recorder.respond = { _ in (200, #"{"epoch":0,"entries":[],"next_after":null}"#) }
    let signer = try Self.phone
    _ = try await client(recorder, signer: signer).log(epoch: 0, after: -1)
    let request = try #require(recorder.requests.first)
    let ts = try #require(request.value(forHTTPHeaderField: "x-argus-ts").flatMap { Int64($0) })
    let message = AccountCodec.requestSigningBytes(
      method: "GET", pathAndQuery: "/argus/account/v1/log?epoch=0&after=-1", ts: ts, body: Data())
    let sig = try #require(request.value(forHTTPHeaderField: "x-argus-sig"))
    #expect(AccountCodec.verify(message, signature: sig, publicKey: try AccountCodec.signingPublicKey(seed: signer.seed)))
  }

  @Test("identity routes always go on Clerk, even for a live member")
  func identityRoutes() async throws {
    let recorder = Recorder()
    recorder.respond = { request in
      request.url!.path.hasSuffix("/join")
        ? (200, #"{"request_id":"r","expires_at":1}"#) : (200, #"{"account_id":"a","epoch":0,"head_seq":0}"#)
    }
    let signer = try Self.phone
    let api = client(recorder, signer: signer)
    _ = try await api.account()
    _ = try await api.resetAccount(epoch: 1, entries: [])
    let member = AccountMember.device(id: "d", kind: "ios", signPub: "p", noisePub: "n", name: "Phone", createdAt: 1)
    _ = try await api.join(member: member, proof: "proof")
    #expect(recorder.requests.count == 3)
    for request in recorder.requests {
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer clerk")
      #expect(request.value(forHTTPHeaderField: "x-argus-sig") == nil)
    }
  }

  @Test("not a live member yet: member routes go on Clerk")
  func noSignerUsesClerk() async throws {
    let recorder = Recorder()
    recorder.respond = { _ in (200, #"{"hosts":[]}"#) }
    _ = try await client(recorder, signer: nil).directory()
    #expect(recorder.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer clerk")
  }

  @Test("an old service refusing the device key gets one Clerk retry, then Clerk for the launch")
  func clerkFallback() async throws {
    let recorder = Recorder()
    recorder.respond = { request in
      request.value(forHTTPHeaderField: "x-argus-sig") != nil
        ? (403, #"{"error":"forbidden"}"#) : (200, #"{"hosts":[]}"#)
    }
    let fallbacks = Counter()
    let api = client(recorder, signer: try Self.phone, fallback: { fallbacks.bump() })
    _ = try await api.directory()
    #expect(recorder.requests.count == 2)
    #expect(recorder.requests[1].value(forHTTPHeaderField: "Authorization") == "Bearer clerk")
    #expect(api.usesClerkForMembers)
    _ = try await api.directory()
    #expect(recorder.requests.count == 3)
    #expect(recorder.requests[2].value(forHTTPHeaderField: "x-argus-sig") == nil)
    #expect(fallbacks.count == 1)
  }

  @Test("a refused signature with no sign-in to fall back on says so")
  func refusedWithoutClerk() async throws {
    let recorder = Recorder()
    recorder.respond = { _ in (401, #"{"error":"unauthorized"}"#) }
    let api = client(recorder, token: nil, signer: try Self.phone)
    await #expect(throws: AccountServiceError.memberRefused(status: 401)) { try await api.directory() }
    #expect(!api.usesClerkForMembers)
  }

  @Test("a refused signature while the clock is off is the clock")
  func clockSkew() async throws {
    let api = AccountClient(
      baseURL: URL(string: "https://example.test/argus/account/v1")!, token: { nil }, signer: { try? Self.phone },
      http: { request in
        (
          Data(#"{"error":"unauthorized"}"#.utf8),
          HTTPURLResponse(
            url: request.url!, statusCode: 401, httpVersion: nil,
            headerFields: ["Date": "Sun, 06 Nov 1994 08:49:37 GMT"])!
        )
      })
    await #expect(throws: AccountServiceError.clockSkew) { try await api.directory() }
  }

  @Test("an account_reset refusal carries the new epoch and genesis")
  func accountReset() async throws {
    let recorder = Recorder()
    recorder.respond = { _ in (410, #"{"error":"account_reset","epoch":2,"genesis":{"body":"b","sigs":{"x":"y"}}}"#) }
    let api = client(recorder, signer: try Self.phone)
    await #expect(throws: AccountServiceError.accountReset(epoch: 2, genesis: AccountEntry(body: "b", sigs: ["x": "y"]))) {
      _ = try await api.log(epoch: 1, after: 0)
    }
  }
}
