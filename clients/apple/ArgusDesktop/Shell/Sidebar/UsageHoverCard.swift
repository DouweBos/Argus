import ArgusCore
import ArgusUI
import SwiftUI

/// What resting the pointer on the sidebar's Usage button shows: each
/// account's current session limit.
struct UsageHoverCard: View {
  @Environment(\.theme) private var theme
  let limits: ArgusProtocol.ClaudeUsageLimits?
  let error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Current session")
        .font(.scaled(size: 13, weight: .semibold))
        .foregroundStyle(theme.text)
      content
    }
    .padding(12)
    .frame(width: 260, alignment: .leading)
    .floatingSurface()
  }

  @ViewBuilder private var content: some View {
    if let limits, !limits.accounts.isEmpty {
      TimelineView(.periodic(from: .now, by: 30)) { context in
        VStack(alignment: .leading, spacing: 10) {
          ForEach(limits.accounts, id: \.accountId) { account in
            row(account, now: context.date)
          }
        }
      }
    } else if limits != nil {
      note("No Claude accounts")
    } else if let error {
      note(error, tone: theme.error)
    } else {
      note("Checking plan limits…")
    }
  }

  private func row(_ account: ArgusProtocol.ClaudeAccountLimits, now: Date) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text(account.label)
          .font(.scaled(size: 11, weight: .medium))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
          .truncationMode(.middle)
        if let plan = account.subscriptionType, !plan.isEmpty {
          Badge(label: plan.capitalized)
        }
      }
      if account.status == .failed {
        note("Couldn't read this account's limits", tone: theme.error)
      } else if let session = Self.session(account) {
        UsageMeterLine(window: session, now: now)
      } else {
        note("No session limit")
      }
    }
  }

  private func note(_ text: String, tone: Color? = nil) -> some View {
    Text(text)
      .font(.scaled(size: 11))
      .foregroundStyle(tone ?? theme.textMuted)
      .fixedSize(horizontal: false, vertical: true)
  }

  static func session(_ account: ArgusProtocol.ClaudeAccountLimits) -> ArgusProtocol.UsageLimitWindow? {
    account.windows.first { $0.kind == .session }
  }

  /// The most severe session limit shown, for telemetry.
  static func level(_ limits: ArgusProtocol.ClaudeUsageLimits?) -> String {
    let used = (limits?.accounts ?? []).compactMap(session).map(\.usedPercent).max() ?? 0
    return switch UsageLimitFormat.level(usedPercent: used) {
    case .normal: "normal"
    case .warning: "warning"
    case .critical: "critical"
    }
  }
}
