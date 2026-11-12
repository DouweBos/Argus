import ArgusKit
import Testing

@testable import ArgusCore

struct RunnerAccountsTests {
  private func account(
    _ status: ArgusProtocol.RunnerAccountStatus, logout: String? = "x logout", canProbe: Bool = true
  ) -> ArgusProtocol.RunnerAccount {
    .init(
      id: "x", displayName: "X", isCustom: false, status: status, canProbe: canProbe,
      setup: .init(installCommand: "install x", loginCommand: "x login", logoutCommand: logout))
  }

  @Test func offersWhatEachStatusAllows() {
    #expect(account(.notInstalled).actions == [.install, .checkAgain])
    #expect(account(.notInstalled).primaryAction == .install)
    #expect(account(.signedOut).actions == [.signIn, .checkAgain])
    #expect(account(.signedOut).primaryAction == .signIn)
    #expect(account(.signedIn).actions == [.signOut, .checkAgain])
    #expect(account(.signedIn, logout: nil).actions == [.checkAgain])
    #expect(account(.unknown).actions == [.signIn, .signOut, .checkAgain])
  }

  @Test func saysWhyStatusIsUnknown() {
    #expect(account(.unknown).statusLabel == "Status unknown")
    #expect(account(.unknown, canProbe: false).statusLabel == "Can't check sign-in")
  }

  @Test func foldsMissingRunnersOnceThereAreMany() {
    let few = RunnerAccountSections([account(.signedIn), account(.notInstalled)])
    #expect(few.installed.count == 1)
    #expect(!few.collapsesMissing)
    let many = RunnerAccountSections(Array(repeating: account(.notInstalled), count: 4))
    #expect(many.collapsesMissing)
  }
}
