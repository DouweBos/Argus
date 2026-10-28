@testable import ArgusCore
import Foundation
import Testing

@MainActor
@Suite("Account profile")
struct AccountProfileTests {
  let service = FakeAccountService()
  let auth = FakeAccountAuth()

  @Test("the profile is published on sign-in and dropped on sign-out")
  func profile() async throws {
    auth.user = AccountProfile(firstName: "Ada", lastName: "Lovelace", email: "ada@example.com")
    let store = AccountStore(
      auth: auth, vault: MemoryAccountVault(.empty), deviceKind: "ios", deviceName: { "Phone" },
      baseURL: URL(string: "https://example.test/argus/account/v1")!, http: service.http)
    await store.start()
    #expect(store.profile == nil)
    await store.signIn(with: .apple)
    #expect(store.profile?.displayName == "Ada Lovelace")
    #expect(store.profile?.subtitle == "ada@example.com")
    await store.signOut()
    #expect(store.profile == nil)
  }

  @Test("the profile's name falls back to the username, then the email")
  func profileFallbacks() {
    let full = AccountProfile(firstName: "Ada", lastName: "Lovelace", username: "ada", email: "ada@example.com")
    #expect(full.displayName == "Ada Lovelace")
    #expect(full.initials == "AL")
    #expect(full.subtitle == "ada@example.com")
    let user = AccountProfile(firstName: " ", username: "ada", email: "ada@example.com")
    #expect(user.displayName == "ada")
    #expect(user.initials == "A")
    let mail = AccountProfile(email: "ada@example.com")
    #expect(mail.displayName == "ada@example.com")
    #expect(mail.subtitle == nil)
    #expect(AccountProfile().displayName == nil)
    #expect(AccountProfile().initials == "")
  }
}
