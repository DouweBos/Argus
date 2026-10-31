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
        EmptyState(
          icon: "tray", title: "This proposal is gone",
          body: "It was decided on, or the host that raised it is no longer attached."
        ) {
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
        Button("The session it started") { model.openAgents(session: session) }
      }
    }
    .buttonStyle(.accentLink)
  }

  private func decidedNote(_ proposal: ArgusProtocol.Proposal) -> String? {
    AutomationText.decidedNote(
      proposal, automation: model.automations.automations.first { $0.id == proposal.automationId }?.name)
  }
}
