import ArgusCore
import ArgusKit
import SwiftUI

/// Every decision an agent is waiting on, each in a warning box: its title,
/// the call itself, then the form that answers it.
public struct TranscriptPrompts: View {
  @Environment(\.theme) private var theme

  let agentKey: String
  let pending: [RemoteToolCall]

  public init(agentKey: String, pending: [RemoteToolCall]) {
    self.agentKey = agentKey
    self.pending = pending
  }

  public var body: some View {
    ForEach(pending) { call in
      VStack(alignment: .leading, spacing: 10) {
        PromptTitle(call: call)
        ToolCallCard(agentKey: agentKey, call: call, depth: 0)
        PendingCallForm(agentKey: agentKey, call: call, showsTitle: false)
      }
      .padding(12)
      .background(theme.warningSoft, in: RoundedRectangle(cornerRadius: theme.radius))
      .overlay(
        RoundedRectangle(cornerRadius: theme.radius).stroke(theme.warning.opacity(0.5), lineWidth: 1))
    }
  }
}

/// What a pending call is asking for, with a pulsing warning dot.
struct PromptTitle: View {
  @Environment(\.theme) private var theme
  let call: RemoteToolCall

  var body: some View {
    HStack(spacing: 6) {
      StatusDot(tone: .warning, pulse: true)
      Text(PendingPrompts.title(for: call))
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.text)
    }
  }
}

/// The decision a pending call is waiting on: its question form, plan
/// approval, or Allow / Always Allow / Deny. Shared by top-level calls and
/// sub-agent calls, which need an answer just the same.
struct PendingCallForm: View {
  @Environment(HostStore.self) private var host

  let agentKey: String
  let call: RemoteToolCall
  var showsTitle = true

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if showsTitle { PromptTitle(call: call) }
      form
    }
  }

  /// The repo behind this agent, for seeding a sibling session from a plan.
  private var planRepoRoot: String? {
    host.statusByAgent[agentKey].flatMap { host.repoRoot(forSessionId: $0.sessionId) }
  }

  @ViewBuilder
  private var form: some View {
    switch PendingForm.of(name: call.name, input: call.input) {
    case .question(let questions):
      QuestionFormView(
        questions: questions,
        onSubmit: { respond("deny", $0) },
        onCancel: { respond("deny", CannedReply.cancelQuestion) })
    case .plan(let plan):
      PlanApprovalView(
        plan: plan,
        onApprove: {
          host.noteLeftPlanMode(agentId: agentKey)
          respond("allow", nil)
        },
        onKeepPlanning: { respond("deny", CannedReply.keepPlanning) },
        onFeedback: { respond("deny", CannedReply.planFeedback($0)) },
        // No repo, nowhere to put the session — same rule as the desktop.
        onApproveInNewSession: planRepoRoot.map { repoRoot in
          {
            Task { await host.handOffPlan(repoRoot: repoRoot, plan: plan) }
            respond("deny", CannedReply.planHandoff)
          }
        })
    case .buttons:
      PermissionButtons(
        onAllow: { respond("allow", nil) },
        onDeny: { respond("deny", nil) },
        alwaysAllow: alwaysAllow)
    }
  }

  /// Only the local backend can send a session rule.
  private var alwaysAllow: (rule: String, action: () -> Void)? {
    guard host.backend?.kind == .local else { return nil }
    let rule = AlwaysAllowRule.rule(name: call.name, input: call.input)
    return (rule, {
      Task {
        await host.respond(agentId: agentKey, toolUseId: call.id, decision: "allow", alwaysAllow: rule)
      }
    })
  }

  private func respond(_ decision: String, _ message: String?) {
    Task {
      await host.respond(agentId: agentKey, toolUseId: call.id, decision: decision, message: message)
    }
  }
}
