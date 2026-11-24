package dev.houwert.argus.app.screens.inbox

import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.teammates.ProposalOrigin
import dev.houwert.argus.kit.protocol.generated.RemoteProposal

/** The screen that raised a proposal and what its link says; null when nothing says. */
internal data class ProposalOriginLink(val route: Route, val label: String) {
  companion object {
    fun of(proposal: RemoteProposal): ProposalOriginLink? = when (val origin = ProposalOrigin.of(proposal.automationId, proposal.runId)) {
      is ProposalOrigin.Run -> ProposalOriginLink(Route.Run(origin.runId, proposal.automationName), "View run")
      is ProposalOrigin.TeammateChat ->
        ProposalOriginLink(Route.Teammate(origin.teammateId, proposal.automationName, origin.threadId), "View conversation")
      null -> null
    }
  }
}
