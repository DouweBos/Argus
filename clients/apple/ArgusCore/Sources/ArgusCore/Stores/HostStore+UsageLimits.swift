import ArgusKit
import Foundation

/// How much of each Claude plan window is left, per signed-in account. The
/// same `usage.limits` method serves the phone's gateway and the Mac's socket.
extension HostStore {
  /// `refresh` skips the host's short cache — for an explicit pull or button.
  public func loadUsageLimits(refresh: Bool = false) async {
    guard let backend, !usageLimitsLoading else { return }
    usageLimitsLoading = true
    defer { usageLimitsLoading = false }
    do {
      usageLimits = try await backend.request(
        .usageLimits,
        ArgusProtocol.MethodsTypes.UsageLimitsParams(refresh: refresh ? true : nil),
        as: ArgusProtocol.ClaudeUsageLimits.self)
      usageLimitsError = nil
    } catch {
      // A poll that lost its connection keeps what it had and retries on reconnect.
      guard !Self.isQuiet(error) else { return }
      usageLimitsError = Self.describe(error)
      hooks.errorReported(error, "usage_limits")
    }
  }

  /// One account's fresh numbers, pushed by the host; nothing loaded yet means nothing shown to update.
  func mergeUsageLimits(_ account: ArgusProtocol.ClaudeAccountLimits) {
    guard var limits = usageLimits else { return }
    if let index = limits.accounts.firstIndex(where: { $0.accountId == account.accountId }) {
      limits.accounts[index] = account
    } else {
      limits.accounts.append(account)
    }
    usageLimits = limits
  }
}
