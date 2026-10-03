import ArgusCore
import ArgusUI
import SwiftUI

/// `/inbox/proposals/:proposalId` — one proposal in full, where it gets
/// decided. Deciding ends it, so a dismissal or a "done" goes back to the
/// inbox and a start follows the session; one already decided still reads here.
struct ProposalScreen: View {
  @Environment(DesktopModel.self) private var model
  let proposalId: String
  @State private var looked = false

  private var proposal: ArgusProtocol.Proposal? { model.inbox.proposal(id: proposalId) }

  var body: some View {
    Group {
      if let proposal {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            ProposalCardView(proposal: proposal, decided: decidedNote(proposal)) {
              model.navigate(.inbox)
            }
            provenance(proposal)
          }
          .padding(24)
          .frame(maxWidth: 820, alignment: .leading)
          .frame(maxWidth: .infinity)
        }
      } else if looked || model.inbox.loaded {
        ContentUnavailableView {
          Label("This proposal is gone", systemImage: "tray")
        } description: {
          Text("It was decided on, or the host that raised it is no longer attached.")
        } actions: {
          Button("Back to the Inbox") { model.navigate(.inbox) }
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle(proposal?.title ?? "Proposal")
    .navigationSubtitle("Inbox")
    .toolbar {
      ToolbarItem(placement: .navigation) {
        Button { model.navigate(.inbox) } label: { Label("Inbox", systemImage: "chevron.left") }
          .help("Back to the inbox")
      }
    }
    .task {
      if proposal == nil { await model.inbox.refresh() }
      looked = true
    }
  }

  private func provenance(_ proposal: ArgusProtocol.Proposal) -> some View {
    let automation = model.automations.automations.first { $0.id == proposal.automationId }
    return HStack(spacing: 14) {
      Text("Came from").foregroundStyle(.secondary)
      Button(automation.map { "\($0.name) — this run" } ?? "The run that raised it") {
        AutomationActions.openRun(model, automationId: proposal.automationId, runId: proposal.runId)
      }
      if let automation {
        Button("The automation") { model.navigate(.automation(id: automation.id, runId: nil)) }
      }
      if let replacement = proposal.supersededBy {
        Button("The proposal that replaced it") { model.navigate(.proposal(id: replacement)) }
      }
      if let session = proposal.sessionId {
        Button("The session it started") { model.navigate(.sessionHome(id: session)) }
      }
    }
    .buttonStyle(.link)
  }

  /// What happened to a proposal nobody can act on any more. A withdrawal
  /// names the automation: it was Argus's call, and the reason is its evidence.
  private func decidedNote(_ proposal: ArgusProtocol.Proposal) -> String? {
    let by = model.automations.automations.first { $0.id == proposal.automationId }?.name
      ?? "the automation"
    let cleared = proposal.clearedReason.map { ": \($0)" }
    switch proposal.status {
    case .pending: return nil
    case .accepted: return "You started this. It is in the session below."
    case .autoStarted: return "Argus started this itself — the guardrails allowed it."
    case .dismissed:
      return proposal.dismissedReason.map { "You dismissed this: \($0)" } ?? "You dismissed this."
    case .resolved:
      return proposal.resolvedNote.map { "You marked this done: \($0)" }
        ?? "You marked this done — you handled it yourself."
    case .superseded: return "A later run of \(by) proposed the same work again\(cleared ?? ".")"
    default:
      return "\(by) withdrew this\(cleared ?? " — the signal behind it went away.")"
    }
  }
}
