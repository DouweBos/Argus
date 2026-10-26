import ArgusKit
import Foundation

/// Tokens and estimated cost over a range, read from Claude Code transcripts on
/// the host. The same `usage.summary` method serves the gateway and the socket.
extension HostStore {
  /// A newer range supersedes one still loading; the stale answer is dropped.
  public func loadUsageSummary(range: ArgusProtocol.UsageRange) async {
    guard let backend, usageSummaryLoadingRange != range else { return }
    usageSummaryLoadingRange = range
    do {
      let summary = try await backend.request(
        .usageSummary, ArgusProtocol.MethodsTypes.UsageSummaryParams(range: range),
        as: ArgusProtocol.ClaudeUsageSummary.self)
      guard usageSummaryLoadingRange == range else { return }
      usageSummary = summary
      usageSummaryError = nil
    } catch {
      guard usageSummaryLoadingRange == range else { return }
      usageSummaryError = Self.describe(error)
      hooks.errorReported(error, "usage_summary")
    }
    usageSummaryLoadingRange = nil
  }
}
