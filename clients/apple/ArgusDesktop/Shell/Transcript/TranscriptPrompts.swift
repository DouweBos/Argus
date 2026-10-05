import ArgusUI
import SwiftUI

/// Every decision the focused agent is waiting on, at the foot of the
/// transcript: the call itself, then its question form, plan approval, or
/// Allow / Deny. Answered through `HostStore.respond`, like iOS.
struct TranscriptPrompts: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let agentKey: String
  let pending: [RemoteToolCall]

  var body: some View {
    ForEach(pending) { call in
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 6) {
          StatusDot(tone: .warning, pulse: true)
          Text(title(for: call))
            .font(.scaled(size: 12, weight: .semibold))
            .foregroundStyle(theme.text)
        }
        ToolCallCard(agentKey: agentKey, call: call, depth: 0)
        form(for: call)
      }
      .padding(12)
      .background(theme.warningSoft, in: RoundedRectangle(cornerRadius: theme.radius))
      .overlay(
        RoundedRectangle(cornerRadius: theme.radius).stroke(theme.warning.opacity(0.5), lineWidth: 1))
    }
  }

  private func title(for call: RemoteToolCall) -> String {
    switch PendingForm.of(name: call.name, input: call.input) {
    case .question: "Question from the agent"
    case .plan: "Plan ready for review"
    case .buttons: "Permission needed"
    }
  }

  private var planRepoRoot: String? {
    host.statusByAgent[agentKey].flatMap { host.repoRoot(forSessionId: $0.sessionId) }
  }

  @ViewBuilder
  private func form(for call: RemoteToolCall) -> some View {
    switch PendingForm.of(name: call.name, input: call.input) {
    case .question(let questions):
      QuestionFormView(
        questions: questions,
        onSubmit: { respond(call, "deny", $0) },
        onCancel: { respond(call, "deny", CannedReply.cancelQuestion) })
    case .plan(let plan):
      PlanApprovalView(
        plan: plan,
        onApprove: {
          host.noteLeftPlanMode(agentId: agentKey)
          respond(call, "allow", nil)
        },
        onKeepPlanning: { respond(call, "deny", CannedReply.keepPlanning) },
        onFeedback: { respond(call, "deny", CannedReply.planFeedback($0)) },
        onApproveInNewSession: planRepoRoot.map { repoRoot in
          {
            Task { await host.handOffPlan(repoRoot: repoRoot, plan: plan) }
            respond(call, "deny", CannedReply.planHandoff)
          }
        })
    case .buttons:
      let rule = AlwaysAllowRule.rule(name: call.name, input: call.input)
      PermissionButtons(
        onAllow: { respond(call, "allow", nil) },
        onDeny: { respond(call, "deny", nil) },
        alwaysAllow: (rule, {
          Task { await host.respond(agentId: agentKey, toolUseId: call.id, decision: "allow", alwaysAllow: rule) }
        }))
    }
  }

  private func respond(_ call: RemoteToolCall, _ decision: String, _ message: String?) {
    Task {
      await host.respond(agentId: agentKey, toolUseId: call.id, decision: decision, message: message)
    }
  }
}
