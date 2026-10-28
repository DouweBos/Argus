import Foundation
import Testing

@testable import ArgusKit

/// The Swift verifier against the TS golden fixtures in
/// `packages/remote-protocol/src/account/fixtures`: both must reject the same
/// entry for the same reason, or a phone and a host disagree about who's trusted.
@Suite("Account log")
struct AccountLogTests {
  static let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("packages/remote-protocol/src/account/fixtures")

  struct Fixture: Decodable {
    struct Expect: Decodable {
      let ok: Bool
      let head_seq: Int?
      let live_members: [String]?
      let reason: String?
      let index: Int?
    }
    struct Admission: Decodable {
      let member_id: String
      let request_id: String
      let sas_commit: String
      let admitted: Bool
    }
    struct Presence: Decodable {
      let record: AccountDirectoryRecord
      let valid: Bool
    }
    let name: String
    let pin: AccountRoot?
    let entries: [AccountEntry]
    let expect: Expect
    let admission: Admission?
    let presence: [Presence]?
  }

  struct Key: Decodable {
    let id: String
    let sign_priv: String
    let sign_pub: String
    let noise_pub: String
  }

  static func load<T: Decodable>(_ name: String, as _: T.Type) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(contentsOf: fixtures.appendingPathComponent(name)))
  }

  static let logFixtures: [String] = {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: fixtures.path)) ?? []
    return names.filter { $0.hasSuffix(".json") && !["keys.json", "sas.json", "push_key.json"].contains($0) }.sorted()
  }()

  @Test("the fixtures are there")
  func fixturesFound() {
    #expect(Self.logFixtures.count >= 10)
  }

  @Test("matches every fixture's verdict", arguments: logFixtures)
  func fixture(_ file: String) throws {
    let fixture = try Self.load(file, as: Fixture.self)
    let result = AccountLog.verify(fixture.entries, root: fixture.pin)
    switch result {
    case .ok(let state):
      #expect(fixture.expect.ok, "\(fixture.name) verified but should fail")
      #expect(state.head.seq == fixture.expect.head_seq)
      #expect(Set(state.liveMembers.map(\.id)) == Set(fixture.expect.live_members ?? []))
      if let admission = fixture.admission {
        #expect(
          state.admits(
            memberId: admission.member_id, requestId: admission.request_id,
            sasCommit: admission.sas_commit) == admission.admitted)
      }
      for presence in fixture.presence ?? [] {
        #expect((AccountLog.verifyPresence(presence.record, state: state) != nil) == presence.valid)
      }
    case .rejected(let reason, let index, _):
      #expect(!fixture.expect.ok, "\(fixture.name) failed with \(reason) at \(index)")
      #expect(reason.rawValue == fixture.expect.reason)
      #expect(index == fixture.expect.index)
    }
  }

  @Test("an empty log with nothing prior is malformed")
  func emptyLog() {
    guard case .rejected(.malformed, 0, nil) = AccountLog.verify([]) else {
      Issue.record("expected malformed at 0")
      return
    }
  }

  @Test("prior state for another genesis than the pin is a fork")
  func priorAgainstOtherPin() throws {
    let fixture = try Self.load("valid_chain.json", as: Fixture.self)
    let state = try #require(AccountLog.verify(fixture.entries).state)
    let other = AccountRoot(accountId: state.accountId, epoch: 0, genesisHash: String(repeating: "0", count: 64))
    guard case .rejected(.fork, 0, nil) = AccountLog.verify([], root: other, prior: state) else {
      Issue.record("expected fork at 0")
      return
    }
  }

  @Test("verifies incrementally on top of a prior state")
  func incremental() throws {
    let fixture = try Self.load("valid_chain.json", as: Fixture.self)
    let first = try #require(AccountLog.verify(Array(fixture.entries.prefix(3))).state)
    let rest = AccountLog.verify(Array(fixture.entries.dropFirst(3)), root: first.root, prior: first)
    guard case .ok(let state) = rest else {
      Issue.record("expected ok")
      return
    }
    #expect(state.head.seq == 7)
  }

  @Test("the SAS vector matches the TS one")
  func sasVector() throws {
    struct Vector: Decodable {
      struct Input: Decodable {
        let account_id: String
        let epoch: Int
        let head_hash: String
        let approver_sign_pub: String
        let subject_sign_pub: String
        let subject_noise_pub: String
        let request_id: String
      }
      let input: Input
      let sas: String
      let commit: String
    }
    for vector in try Self.load("sas.json", as: [Vector].self) {
      let i = vector.input
      let sas = try AccountSas.compute(
        .init(
          accountId: i.account_id, epoch: i.epoch, headHash: i.head_hash,
          approverSignPub: i.approver_sign_pub, subjectSignPub: i.subject_sign_pub,
          subjectNoisePub: i.subject_noise_pub, requestId: i.request_id))
      #expect(sas.sas == vector.sas)
      #expect(sas.commit == vector.commit)
    }
  }

  @Test("entries this client writes verify, and tampering breaks them")
  func signingRoundTrip() throws {
    let keys = try Self.load("keys.json", as: [String: Key].self)
    let phone = try #require(keys["phone"])
    let mini = try #require(keys["mini"])
    let phoneSigner = AccountSigner(id: phone.id, seed: try #require(AccountCodec.fromB64(phone.sign_priv)))
    #expect(try AccountCodec.signingPublicKey(seed: phoneSigner.seed) == phone.sign_pub)

    let device = AccountMember.device(
      id: phone.id, kind: "ios", signPub: phone.sign_pub, noisePub: phone.noise_pub, name: "Phone",
      createdAt: 1_800_000_000_000)
    let genesis = try AccountEntryBuilder.make(
      accountId: "abcdefghijklmnopqrstuvwxyz", epoch: 0, head: nil, signer: phoneSigner, .genesis(member: device))
    let host = AccountMember(
      id: mini.id, role: .host, platform: "darwin", signPub: mini.sign_pub, noisePub: mini.noise_pub,
      name: "Mini", createdAt: 1_800_000_000_001)
    let proof = try AccountEntryBuilder.proof(
      for: host, seed: try #require(AccountCodec.fromB64(mini.sign_priv)))
    let addHost = try AccountEntryBuilder.make(
      accountId: "abcdefghijklmnopqrstuvwxyz", epoch: 0, head: AccountHead(seq: 0, hash: genesis.hash),
      signer: phoneSigner, .addHost(member: host, requestId: "req", sasCommit: "", proof: proof))

    guard case .ok(let state) = AccountLog.verify([genesis, addHost]) else {
      Issue.record("own entries didn't verify")
      return
    }
    #expect(state.liveMembers.map(\.id) == [phone.id, mini.id])
    #expect(state.admits(memberId: mini.id, requestId: "req", sasCommit: ""))
    #expect(state.root.safetyCode.count == 14)

    var tampered = addHost
    tampered.body = tampered.body.replacingOccurrences(of: "\"Mini\"", with: "\"Evil\"")
    guard case .rejected(.badSignature, 1, _) = AccountLog.verify([genesis, tampered]) else {
      Issue.record("tampered entry verified")
      return
    }
  }

  @Test("link codes normalize the way the service does")
  func userCodes() {
    #expect(AccountCodec.normalizeUserCode("wdjb mjht") == "WDJB-MJHT")
    #expect(AccountCodec.normalizeUserCode("WDJB-MJHT") == "WDJB-MJHT")
    #expect(AccountCodec.normalizeUserCode("wd-jb-mj-ht!") == "WDJB-MJHT")
  }

  @Test("old pairings decode as paired")
  func identityDefaults() throws {
    let json = """
      {"deviceId":"d","devPrivB64":"a","devPubB64":"b","desktopPubB64":"c","url":"ws://x","capabilities":[]}
      """
    let identity = try JSONDecoder().decode(DeviceIdentity.self, from: Data(json.utf8))
    #expect(identity.source == .paired)
    #expect(identity.accountHostId == nil)
  }

  @Test("paired and account hosts merge by the host's key")
  func mergeHosts() {
    let paired = DeviceIdentity(
      deviceId: "p", devPrivB64: "", devPubB64: "", desktopPubB64: "K", url: "ws://lan", capabilities: ["control"])
    let account = DeviceIdentity(
      deviceId: "account:h", devPrivB64: "", devPubB64: "", desktopPubB64: "K", url: "",
      endpoints: [RemoteEndpoint(kind: .cloudflare, url: "wss://new", priority: 2)], capabilities: [],
      source: .account, accountHostId: "h")
    let other = DeviceIdentity(
      deviceId: "account:o", devPrivB64: "", devPubB64: "", desktopPubB64: "O", url: "", capabilities: [],
      source: .account, accountHostId: "o")
    let merged = [DeviceIdentity].merging(paired: [paired], account: [account, other])
    #expect(merged.map(\.deviceId) == ["p", "account:o"])
    #expect(merged[0].accountHostId == "h")
    #expect(merged[0].endpoints?.map(\.url) == ["wss://new"])
  }
}
