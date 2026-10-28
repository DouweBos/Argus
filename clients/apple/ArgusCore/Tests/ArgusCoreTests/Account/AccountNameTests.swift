@testable import ArgusCore
import Foundation
import Testing

/// The device-name setting against the account: joining with it, renaming on
/// change (queued while offline), following a rename from another device, and
/// the list's Rename editing the same setting.
@MainActor
@Suite("Account name")
struct AccountNameTests {
  typealias TestKey = AccountStoreTests.TestKey

  let service = FakeAccountService()
  let auth = FakeAccountAuth()

  /// The app's side: a setting the store reads and writes through its hooks.
  final class Setting {
    var name: String
    init(_ name: String) { self.name = name }
  }

  func makeStore(_ setting: Setting, vault: AccountVault = .empty, localHost: (any AccountLocalHostLinking)? = nil)
    -> AccountStore
  {
    let store = AccountStore(
      auth: auth, vault: MemoryAccountVault(vault), deviceKind: "mac", deviceName: { setting.name },
      localHost: localHost, baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http,
      joinPollInterval: .seconds(3600))
    store.onNameChanged = { setting.name = $0 }
    return store
  }

  func bodies() -> [[String: Any]] {
    service.log.map { try! JSONSerialization.jsonObject(with: Data($0.body.utf8)) as! [String: Any] }
  }

  func renames() -> [(id: String, name: String)] {
    bodies().filter { $0["type"] as? String == "rename" }.map {
      ($0["member_id"] as? String ?? "", $0["name"] as? String ?? "")
    }
  }

  @Test("validation trims and rejects empty, overlong and multi-line names")
  func validation() {
    #expect(AccountDeviceKeys.validatedName("  Studio  ") == "Studio")
    #expect(AccountDeviceKeys.validatedName("   ") == nil)
    #expect(AccountDeviceKeys.validatedName(String(repeating: "a", count: 65)) == nil)
    #expect(AccountDeviceKeys.validatedName(String(repeating: "a", count: 64)) != nil)
    #expect(AccountDeviceKeys.validatedName("two\nlines") == nil)
    #expect(AccountDeviceKeys.validatedName("tab\there") == nil)
  }

  @Test("the first device starts the account under the setting's name")
  func genesisUsesSetting() async {
    let setting = Setting("Studio")
    let store = makeStore(setting)
    await store.start()
    await store.signIn(with: .apple)
    #expect(store.members.first?.name == "Studio")
  }

  @Test("a join request carries the current setting, even with keys from an earlier try")
  func joinUsesSetting() async throws {
    let other = TestKey(1)
    service.seed([
      try AccountEntryBuilder.make(
        accountId: service.accountId, epoch: 0, head: nil, signer: other.signer,
        .genesis(member: other.device("Other")))
    ])
    let setting = Setting("Laptop")
    let keys = TestKey(5).deviceKeys
    let store = makeStore(setting, vault: AccountVault(keys: keys))
    await store.start()
    await store.signIn(with: .apple)
    let requestId = try #require(service.joinIds.first)
    let request = try #require(service.join(requestId))
    #expect(request.member.name == "Laptop")
  }

  @Test("changing the setting renames this Mac and its host; offline it waits")
  func settingRenames() async throws {
    let mac = TestKey(4)
    let local = FakeLocalHost(member: mac.host("hostname-ish"), proof: mac.proof(mac.host("hostname-ish")))
    let setting = Setting("Studio")
    let store = makeStore(setting, localHost: local)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.start()
    await store.signIn(with: .apple)
    // The host is linked under the Mac's name, not its own.
    #expect(store.hosts.first?.name == "Studio")

    service.setAppendDown(true)
    #expect(await store.setName("  Attic ", source: .settings))
    #expect(setting.name == "Attic")
    #expect(renames().isEmpty)
    #expect(store.vault.pendingName == "Attic")

    service.setAppendDown(false)
    await store.refresh()
    let me = try #require(store.memberId)
    #expect(renames().map(\.id) == [me, mac.id])
    #expect(renames().allSatisfy { $0.name == "Attic" })
    #expect(store.vault.pendingName == nil)
    #expect(events.contains(.nameChanged(source: .settings, linked: true)))

    #expect(await store.setName("\n", source: .settings) == false)
    #expect(setting.name == "Attic")
  }

  @Test("a rename from another device updates the setting and aligns the host")
  func remoteRenameReflects() async throws {
    let mac = TestKey(4)
    let local = FakeLocalHost(member: mac.host("Studio"), proof: mac.proof(mac.host("Studio")))
    let setting = Setting("Studio")
    let store = makeStore(setting, localHost: local)
    await store.start()
    await store.signIn(with: .apple)
    let me = try #require(store.memberId)
    let seed = Data(base64Encoded: try #require(store.vault.keys?.signSeed))!
    let state = try #require(store.state)
    // Signed by this device's key, standing in for any other device on the account.
    service.inject(
      try AccountEntryBuilder.make(
        accountId: state.accountId, epoch: 0, head: state.head, signer: AccountSigner(id: me, seed: seed),
        .rename(memberId: me, name: "Kitchen")))

    await store.refresh()
    #expect(setting.name == "Kitchen")
    #expect(store.hosts.first?.name == "Kitchen")
    #expect(renames().last?.id == mac.id)
  }

  @Test("renaming this device from the list edits the setting instead")
  func listRenameEditsSetting() async throws {
    let setting = Setting("Studio")
    let store = makeStore(setting)
    var events: [AccountStore.Event] = []
    store.onEvent = { events.append($0) }
    await store.start()
    await store.signIn(with: .apple)
    events = []

    await store.rename(memberId: try #require(store.memberId), to: "Desk")
    #expect(setting.name == "Desk")
    #expect(store.members.first?.name == "Desk")
    #expect(events == [.nameChanged(source: .accountList, linked: true)])
  }
}
