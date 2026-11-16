import ArgusCore
import ArgusUI
import SwiftUI

/// A run report's proposals as the inbox's own cards, decidable where they
/// were raised; a decided one says what became of it.
struct RunProposals: View {
  @Environment(DesktopModel.self) private var model
  let ids: [String]

  private var inbox: InboxStore { model.inbox }

  var body: some View {
    let found = ids.compactMap(inbox.proposal(id:))
    VStack(alignment: .leading, spacing: 8) {
      ForEach(found, id: \.id) { proposal in
        ProposalCardView(proposal: proposal, decided: decidedNote(proposal), openable: true, linksRun: false)
      }
      if inbox.loaded, found.count < ids.count {
        MutedText(
          "\(AutomationText.plural(ids.count - found.count, "proposal")) from this run "
            + "\(ids.count - found.count == 1 ? "is" : "are") no longer on this host.")
      } else if !inbox.loaded {
        ProgressView().controlSize(.small)
      }
    }
    .task { if !inbox.loaded { await inbox.refresh() } }
  }

  private func decidedNote(_ proposal: ArgusProtocol.Proposal) -> String? {
    AutomationText.decidedNote(
      proposal, automation: model.automations.automations.first { $0.id == proposal.automationId }?.name)
  }
}
