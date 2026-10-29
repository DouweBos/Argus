import ArgusCore
import SwiftUI

/// A chat stalled on a spent usage limit, offering the user's other signed-in
/// Claude accounts. Moving is always their pick: plans may belong to different
/// employers, so nothing here ever switches by itself.
public struct LimitHandoffCard: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  let agentId: String
  let accounts: [ArgusProtocol.LimitHandoffAccount]
  /// The handoff went through; the parent drops the offer.
  let onHandedOff: () -> Void
  @State private var pendingId: String?
  @State private var error: String?

  public init(
    agentId: String, accounts: [ArgusProtocol.LimitHandoffAccount], onHandedOff: @escaping () -> Void
  ) {
    self.agentId = agentId
    self.accounts = accounts
    self.onHandedOff = onHandedOff
  }

  /// A stopped agent can't be moved, so its last stall offers nothing.
  nonisolated static func isStalled(_ status: RemoteAgentStatus?) -> Bool {
    guard let status, status.status != .stopped, status.status != .error else { return false }
    return status.limitStalled == true
  }

  /// "Weekly 58% left · Resets in 4h 29m", or a plain note when the plan didn't say.
  nonisolated static func usageCaption(_ usage: ArgusProtocol.UsageLimitWindow?, now: Date) -> String {
    guard let usage else { return "Usage unknown" }
    let head = "\(usage.label) \(UsageLimitFormat.percentLeft(usedPercent: usage.usedPercent))% left"
    guard let reset = UsageLimitFormat.resetCaption(resetsAtMs: usage.resetsAt, now: now) else { return head }
    return "\(head) · \(reset)"
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      VStack(alignment: .leading, spacing: 3) {
        Label("Usage limit reached", systemImage: Icon.warning)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.warning)
        Text("Continue this chat on another of your accounts. Its plan will be used from here on.")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textSecondary)
      }
      ForEach(accounts, id: \.accountId) { row($0) }
      if let error {
        Text(error).font(.scaled(size: 12)).foregroundStyle(theme.error)
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Tone.warning.soft(theme))
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(
      RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.warning.opacity(0.35), lineWidth: 1))
  }

  private func row(_ account: ArgusProtocol.LimitHandoffAccount) -> some View {
    HStack(spacing: 10) {
      Image(systemName: Icon.person)
        .font(.scaled(size: 18))
        .foregroundStyle(theme.textSecondary)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(account.label).font(.scaled(size: 13, weight: .medium)).foregroundStyle(theme.text)
          if let detail = account.detail {
            Text(detail).font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
          }
        }
        .lineLimit(1)
        .truncationMode(.middle)
        Text(Self.usageCaption(account.usage, now: Date()))
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      if host.hasControl {
        if pendingId == account.accountId {
          ProgressView().controlSize(.small)
        } else {
          Btn(label: "Continue here", tone: .secondary, small: true, hugs: true) {
            handoff(to: account.accountId)
          }
          .disabled(pendingId != nil)
          .accessibilityLabel("Continue on \(account.label)")
        }
      }
    }
  }

  private func handoff(to accountId: String) {
    pendingId = accountId
    error = nil
    Task {
      do {
        try await host.handoffAgent(agentId: agentId, accountId: accountId)
        onHandedOff()
      } catch {
        self.error = HostStore.describe(error)
      }
      pendingId = nil
    }
  }
}

/// Fetches the offer whenever the agent starts or stops being stalled.
struct LimitHandoffLoader: ViewModifier {
  @Environment(HostStore.self) private var host
  let agentId: String
  let stalled: Bool
  @Binding var accounts: [ArgusProtocol.LimitHandoffAccount]

  func body(content: Content) -> some View {
    content.task(id: "\(agentId):\(stalled)") {
      accounts = stalled ? await host.limitHandoffAccounts(agentId: agentId) : []
    }
  }
}

extension View {
  func limitHandoffOffer(
    agentId: String, status: RemoteAgentStatus?, into accounts: Binding<[ArgusProtocol.LimitHandoffAccount]>
  ) -> some View {
    modifier(LimitHandoffLoader(agentId: agentId, stalled: LimitHandoffCard.isStalled(status), accounts: accounts))
  }
}
