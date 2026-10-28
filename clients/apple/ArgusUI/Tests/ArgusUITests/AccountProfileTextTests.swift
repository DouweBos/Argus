import ArgusCore
import ArgusKit
import Testing

@testable import ArgusUI

@Suite("Account profile header")
struct AccountProfileTextTests {
  let ada = AccountProfile(firstName: "Ada", lastName: "Lovelace", email: "ada@example.com")

  @Test("signed in shows the name over the email")
  func signedIn() {
    #expect(AccountProfileText.title(phase: .ready, profile: ada) == "Ada Lovelace")
    #expect(AccountProfileText.subtitle(phase: .ready, profile: ada) == "ada@example.com")
  }

  @Test("an email-only account shows the email once")
  func emailOnly() {
    let mail = AccountProfile(email: "ada@example.com")
    #expect(AccountProfileText.title(phase: .ready, profile: mail) == "ada@example.com")
    #expect(AccountProfileText.subtitle(phase: .ready, profile: mail) == nil)
  }

  @Test("no profile yet falls back to a generic account title")
  func noProfile() {
    #expect(AccountProfileText.title(phase: .ready, profile: nil) == "Argus account")
    #expect(AccountProfileText.subtitle(phase: .ready, profile: nil) == "Signed in")
  }

  @Test("signed out is the sign-in prompt, whatever was cached")
  func signedOut() {
    #expect(AccountProfileText.title(phase: .signedOut, profile: ada) == "Sign in to Argus")
    #expect(AccountProfileText.subtitle(phase: .awaitingApproval, profile: ada) == "Waiting for device approval")
  }
}
