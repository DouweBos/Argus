import ArgusKit
import Foundation

/// Whether each runner besides Claude Code is installed and signed in, as the
/// computer's CLIs report it. Signing in or out runs in a terminal on the
/// computer, so the phone only reads this.
extension HostStore {
  /// `refresh` asks every CLI again instead of the host's short-lived cache.
  public func refreshRunnerAccounts(refresh: Bool = false) async {
    guard let backend else { return }
    do {
      let result = try await backend.request(
        ArgusProtocol.Methods.RunnersAccounts.self, .init(refresh: refresh ? true : nil))
      runnerAccounts = result.runners
    } catch {
      report(error, scope: "runner_accounts")
    }
  }

  /// Re-probe one runner (the Mac's Check Again); admin-only, so never from the phone.
  public func checkRunnerAccount(id: String) async {
    guard let backend else { return }
    do {
      runnerAccounts = try await backend.request(
        ArgusProtocol.Commands.LlmRunnerAccounts.self, .init(refresh: true, runnerId: id))
    } catch {
      report(error, scope: "runner_accounts")
    }
  }

}
