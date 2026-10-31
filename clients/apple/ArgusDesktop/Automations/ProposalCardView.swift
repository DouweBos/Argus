import ArgusCore
import ArgusUI
import SwiftUI

/// The shared `ProposalCard`, wired to the Mac's inbox. The inbox and the
/// proposal's own page both use it.
struct ProposalCardView: View {
  @Environment(DesktopModel.self) private var model
  let proposal: ArgusProtocol.Proposal
  /// Set on the proposal's page once it can't be acted on any more.
  var decided: String?
  /// The inbox opens the proposal's page from its title.
  var openable = false
  /// Where the page goes after a dismissal or a "done".
  var afterDecision: (() -> Void)?

  private var inbox: InboxStore { model.inbox }

  var body: some View {
    ProposalCard(
      content: ProposalCardContent(
        proposal, automationName: model.automations.automations.first { $0.id == proposal.automationId }?.name),
      decided: decided,
      busy: inbox.busy.contains(proposal.id),
      starting: proposal.startStage != nil || inbox.starting.contains(proposal.id),
      requestError: inbox.refusals[proposal.id],
      canDecide: decided == nil,
      actions: ProposalCardActions(
        start: start,
        requestRevision: { note in Task { await inbox.requestRevision(id: proposal.id, note: note) } },
        resolve: { note in
          Task { if await inbox.resolve(id: proposal.id, note: note) { afterDecision?() } }
        },
        dismiss: { reason in
          Task { if await inbox.dismiss(id: proposal.id, reason: reason) { afterDecision?() } }
        },
        cleanup: { Task { await inbox.cleanup(id: proposal.id) } },
        openRun: {
          AutomationActions.openRun(model, automationId: proposal.automationId, runId: proposal.runId)
        },
        openDetails: openable ? { model.navigate(.proposal(id: proposal.id)) } : nil))
  }

  /// The host builds the session and starts the agent; all that's left is to
  /// follow you to it. A slow start shows its stage on the card instead.
  private func start(note: String?) {
    Task {
      guard let result = await inbox.start(id: proposal.id, note: note) else { return }
      model.navigate(.session(id: result.sessionId, agentId: result.agentId))
    }
  }
}
