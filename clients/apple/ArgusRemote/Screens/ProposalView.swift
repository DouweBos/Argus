import ArgusUI
import SwiftUI

/// `/inbox/proposals/:proposalId` — one proposal in full. A pending one is
/// decided here; a decided one still reads here, with what became of it.
struct ProposalView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(ProposalsStore.self) private var proposals

  let proposalId: String
  @State private var looked = false

  private var proposal: RemoteProposal? { proposals.detailById[proposalId] }

  var body: some View {
    Screen {
      if let error = proposals.error {
        Banner(text: error, tone: .danger)
      }
      if let proposal {
        ProposalCard(
          content: ProposalCardContent(proposal, projectKey: host.repoRoot(ofProjectNamed: proposal.project)),
          decided: AutomationText.decidedNote(proposal),
          busy: proposals.busy.contains(proposal.id),
          starting: proposals.isStarting(proposal),
          requestError: proposals.requestErrors[proposal.id],
          canDecide: host.hasControl,
          actions: ProposalCardActions(
            start: accept,
            requestRevision: { note in
              Task { await act { _ = await proposals.requestRevision(id: proposalId, note: note) } }
            },
            resolve: { done in
              Task { await act { await proposals.resolve(id: proposalId, note: done) } }
            },
            dismiss: { reason in
              Task { await act { await proposals.dismiss(id: proposalId, reason: reason) } }
            },
            cleanup: { Task { await act { await proposals.performCleanup(id: proposalId) } } },
            openRun: proposal.runId.map { runId in
              { router.push(.run(id: runId, label: proposal.automationName)) }
            }))
        links(proposal)
      } else if looked {
        EmptyState(
          icon: Icon.envelope, title: "This proposal is gone",
          body: "The computer no longer has it.")
      } else {
        Loading(label: "Reading the proposal…")
      }
    }
    .navigationTitle(proposal?.title ?? "Proposal")
    .navigationBarTitleDisplayMode(.inline)
    .refreshable { await proposals.load(id: proposalId) }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) {
      await proposals.load(id: proposalId)
      looked = true
    }
  }

  @ViewBuilder
  private func links(_ proposal: RemoteProposal) -> some View {
    if let agentId = proposal.agentId {
      Btn(label: "Open the agent working on it", tone: .ghost, small: true, icon: Icon.agent) {
        router.push(.agent(id: agentId, label: proposal.title))
      }
    }
    if let replacement = proposal.supersededBy {
      Btn(label: "The proposal that replaced it", tone: .ghost, small: true) {
        router.push(.proposal(id: replacement))
      }
    }
  }

  private func accept(note: String?) {
    Task {
      guard let agentId = await proposals.accept(id: proposalId, note: note) else {
        await proposals.load(id: proposalId)
        return
      }
      router.push(.agent(id: agentId, label: proposal?.title ?? "Agent"))
    }
  }

  private func act(_ action: () async -> Void) async {
    await action()
    await proposals.load(id: proposalId)
  }
}
