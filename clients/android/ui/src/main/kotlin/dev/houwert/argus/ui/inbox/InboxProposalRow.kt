package dev.houwert.argus.ui.inbox

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import dev.houwert.argus.kit.protocol.generated.RemoteProposal
import dev.houwert.argus.kit.protocol.generated.RemoteProposalStatus
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.icons.Icon

/** A proposal that is no longer a decision: started, or cleared by a later run. Sits in a `ListSection`. */
@Composable
fun InboxProposalRow(
  proposal: RemoteProposal,
  icon: ImageVector,
  subtitle: String?,
  badge: String,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  ListRow(
    proposal.title, modifier, subtitle = subtitle?.takeIf { it.isNotEmpty() }, icon = icon, onClick = onClick,
    trailing = { Badge(badge) },
  )
}

/** Started work: the agent's project, and whether Argus or you started it. */
@Composable
fun StartedProposalRow(proposal: RemoteProposal, onClick: () -> Unit, modifier: Modifier = Modifier) {
  InboxProposalRow(
    proposal, Icon.agent, proposal.project,
    if (proposal.status == RemoteProposalStatus.autoStarted) "auto-started" else "in progress", onClick, modifier,
  )
}

/** Taken off your hands by a later run: why, by which automation, and when. */
@Composable
fun ClearedProposalRow(proposal: RemoteProposal, onClick: () -> Unit, modifier: Modifier = Modifier, nowMillis: Double = System.currentTimeMillis().toDouble()) {
  val subtitle = listOfNotNull(
    proposal.clearedReason ?: "No reason recorded.", proposal.automationName, proposal.clearedAt?.let { Labels.timeAgo(it, nowMillis) },
  ).joinToString(" · ")
  InboxProposalRow(
    proposal, Icon.check, subtitle, if (proposal.status == RemoteProposalStatus.superseded) "replaced" else "withdrawn", onClick, modifier,
  )
}
