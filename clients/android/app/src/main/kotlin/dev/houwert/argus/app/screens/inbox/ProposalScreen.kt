package dev.houwert.argus.app.screens.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteProposal
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.inbox.ProposalCard
import dev.houwert.argus.ui.inbox.ProposalCardActions
import dev.houwert.argus.ui.inbox.ProposalCardContent
import dev.houwert.argus.ui.inbox.ProposalText
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.launch

/** `/inbox/proposals/:proposalId` — one proposal in full. A pending one is decided here; a decided one still reads here. */
@Composable
fun ProposalScreen(id: String) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val proposals = app.proposals
  val connection by app.host.connection.collectAsState()
  val detail by proposals.detailById.collectAsState()
  val error by proposals.error.collectAsState()
  var looked by remember { mutableStateOf(false) }
  val proposal = detail[id]

  LiveRefresh(enabled = connection == Transport.State.Ready, interval = 5.seconds) {
    proposals.load(id)
    looked = true
  }

  TopBarScaffold(proposal?.title ?: "Proposal", onRefresh = { proposals.load(id) }) {
    Screen {
      error?.let { Banner(it, tone = Tone.Danger, onDismiss = proposals::clearError) }
      when {
        proposal != null -> {
          DecidableProposalCard(proposal)
          proposal.agentId?.let { agentId ->
            Btn("Open the agent working on it", tone = ButtonTone.Ghost, small = true, icon = Icon.agent) {
              router.push(Route.Agent(agentId, proposal.title))
            }
          }
          proposal.supersededBy?.let { replacement ->
            Btn("The proposal that replaced it", tone = ButtonTone.Ghost, small = true) { router.push(Route.Proposal(replacement)) }
          }
        }
        looked -> EmptyState(Icon.envelope, "This proposal is gone", body = "The computer no longer has it.")
        else -> Loading("Reading the proposal")
      }
    }
  }
}

/**
 * One proposal's card with every decision wired up, decided ones included; its own page and the
 * run that raised it both show it. [inRun]: no link back to that run, and the title opens the proposal.
 */
@Composable
fun DecidableProposalCard(proposal: RemoteProposal, modifier: Modifier = Modifier, inRun: Boolean = false) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val proposals = app.proposals
  val scope = rememberCoroutineScope()
  val projects by app.host.projects.collectAsState()
  val capabilities by app.host.capabilities.collectAsState()
  val busy by proposals.busy.collectAsState()
  val requestErrors by proposals.requestErrors.collectAsState()
  proposals.requesting.collectAsState().value
  proposals.starting.collectAsState().value
  val id = proposal.id
  fun act(action: suspend () -> Unit) {
    scope.launch {
      action()
      proposals.load(id)
    }
  }

  ProposalCard(
    ProposalCardContent.from(proposal, projects.firstOrNull { it.name == proposal.project }?.repoRoot),
    busy = id in busy,
    starting = proposals.isStarting(proposal),
    canDecide = "control" in capabilities,
    modifier = modifier,
    decided = ProposalText.decidedNote(proposal),
    requestError = requestErrors[id],
    actions = ProposalCardActions(
      start = { note ->
        scope.launch {
          val agentId = proposals.accept(id, note)
          if (agentId == null) proposals.load(id) else router.push(Route.Agent(agentId, proposal.title))
        }
      },
      requestRevision = { note -> act { proposals.requestRevision(id, note) } },
      resolve = { note -> act { proposals.resolve(id, note) } },
      dismiss = { reason -> act { proposals.dismiss(id, reason) } },
      cleanup = { act { proposals.performCleanup(id) } },
      openRun = if (inRun) null else proposal.runId?.let { runId -> { router.push(Route.Run(runId, proposal.automationName)) } },
      openDetails = if (inRun) ({ router.push(Route.Proposal(id)) }) else null,
    ),
  )
}

/** A run report's proposals, decidable where they were raised. For the run screen. */
@Composable
fun RunProposalCards(ids: List<String>, modifier: Modifier = Modifier) {
  val proposals = LocalAppStore.current.proposals
  proposals.detailById.collectAsState().value
  proposals.proposals.collectAsState().value
  var looked by remember(ids) { mutableStateOf(false) }
  LaunchedEffect(ids) {
    for (id in ids) if (proposals.cached(id) == null) proposals.load(id)
    looked = true
  }
  val found = ids.mapNotNull(proposals::cached)
  Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
    found.forEach { DecidableProposalCard(it, inRun = true) }
    val missing = ids.size - found.size
    if (missing > 0) {
      if (looked) {
        MutedText("${ProposalText.plural(missing, "proposal")} from this run ${if (missing == 1) "is" else "are"} no longer on the computer.")
      } else {
        CircularProgressIndicator(Modifier.size(16.dp), color = ArgusTheme.colors.textMuted, strokeWidth = 2.dp)
      }
    }
  }
}
