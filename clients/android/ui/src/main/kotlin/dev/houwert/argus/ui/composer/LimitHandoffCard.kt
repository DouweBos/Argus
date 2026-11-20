package dev.houwert.argus.ui.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.LimitHandoffAccount
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * A chat stalled on a spent usage limit, offering the user's other signed-in Claude accounts and
 * the other installed runners. Moving is always their pick: plans may belong to different
 * employers, so nothing switches by itself.
 */
@Composable
fun LimitHandoffCard(
  host: ComposerHost,
  agentId: String,
  accounts: List<LimitHandoffAccount>,
  runners: List<RemoteRunner>,
  modifier: Modifier = Modifier,
  onContinued: ((RemoteAgentStatus) -> Unit)? = null,
  /** The handoff went through; the parent drops the offer. */
  onHandedOff: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  var pendingId by remember { mutableStateOf<String?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  fun act(id: String, work: suspend () -> Unit) {
    pendingId = id
    error = null
    scope.launch {
      try {
        work()
        onHandedOff()
      } catch (e: Exception) {
        error = host.describe(e)
      }
      pendingId = null
    }
  }
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  Column(
    modifier.fillMaxWidth().clip(shape).background(Tone.Warning.soft(theme))
      .border(1.dp, theme.warning.copy(alpha = 0.35f), shape).padding(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icon.warning, null, Modifier.size(15.dp), tint = theme.warning)
        Text("Usage limit reached", color = theme.warning, style = argusFont(13, FontWeight.SemiBold))
      }
      Text(LimitHandoff.subtitle(accounts.isEmpty(), runners.isEmpty()), color = theme.textSecondary, style = argusFont(12))
    }
    // Past the cap the rows scroll, so a long list never pushes the composer off screen.
    Column(
      Modifier.heightIn(max = LimitHandoff.maxRowsHeight).verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      for (account in accounts) {
        HandoffRow(
          Icon.person, account.label, account.detail, LimitHandoff.usageCaption(account.usage, System.currentTimeMillis()),
          "Continue on ${account.label}", host.hasControl, pendingId, account.accountId,
        ) { act(account.accountId) { host.handoffAgent(agentId, account.accountId) } }
      }
      for (runner in runners) {
        HandoffRow(
          Icon.terminal, runner.displayName, null, "New agent in this worktree", "Continue on ${runner.displayName}",
          host.hasControl, pendingId, runner.id,
        ) { act(runner.id) { onContinued?.invoke(host.continueOnRunner(agentId, runner.id)) } }
      }
    }
    error?.let { Text(it, color = theme.error, style = argusFont(12)) }
  }
}

@Composable
private fun HandoffRow(
  icon: ImageVector,
  title: String,
  detail: String?,
  caption: String,
  actionLabel: String,
  hasControl: Boolean,
  pendingId: String?,
  id: String,
  onContinue: () -> Unit,
) {
  val theme = ArgusTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, Modifier.size(18.dp), tint = theme.textSecondary)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = theme.text, style = argusFont(13, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
        if (detail != null) Text(detail, color = theme.textMuted, style = argusFont(12), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
      }
      Text(caption, color = theme.textMuted, style = argusFont(12), maxLines = 1)
    }
    if (hasControl) {
      if (pendingId == id) {
        CircularProgressIndicator(Modifier.size(18.dp).padding(end = 4.dp), color = theme.textMuted, strokeWidth = 2.dp)
      } else {
        Btn("Continue here", tone = ButtonTone.Secondary, small = true, hugs = true, enabled = pendingId == null, onClick = onContinue)
      }
    }
  }
}

/** The card's rules, apart from Compose so they can be tested. */
object LimitHandoff {
  val maxRowsHeight = 220.dp

  /** A stopped agent can't be moved, so its last stall offers nothing. */
  fun isStalled(status: RemoteAgentStatus?): Boolean {
    if (status == null || status.status == RemoteAgentStatusStatus.stopped || status.status == RemoteAgentStatusStatus.error) return false
    return status.limitStalled == true
  }

  /** Shown while stalled with somewhere to go; not before the accounts have loaded (null), or it would redraw. */
  fun shows(accounts: List<LimitHandoffAccount>?, status: RemoteAgentStatus?, runners: List<RemoteRunner>): Boolean {
    accounts ?: return false
    return accounts.isNotEmpty() || (isStalled(status) && runners.isNotEmpty())
  }

  fun subtitle(noAccounts: Boolean, noRunners: Boolean): String = when {
    !noAccounts && noRunners -> "Continue this chat on another of your accounts. Its plan will be used from here on."
    noAccounts && !noRunners -> "Continue this chat on another agent. It picks up from the chat so far."
    else -> "Continue this chat on another of your accounts, or on another agent that picks up from here."
  }

  /** "Weekly 58% left · Resets in 4h 29m", or a plain note when the plan didn't say. */
  fun usageCaption(usage: UsageLimitWindow?, nowMillis: Long): String {
    usage ?: return "Usage unknown"
    // What is left, rounded down so "100% left" means nothing was used.
    val left = (100 - usage.usedPercent.coerceIn(0.0, 100.0)).toInt()
    val head = "${usage.label} $left% left"
    val reset = usage.resetsAt ?: return head
    val minutes = ((reset - nowMillis) / 60_000).toLong()
    val countdown = when {
      reset <= nowMillis -> return "$head · Resetting now"
      minutes >= 1440 -> "${minutes / 1440}d ${(minutes % 1440) / 60}h"
      minutes >= 60 -> "${minutes / 60}h ${minutes % 60}m"
      minutes > 0 -> "${minutes}m"
      else -> "<1m"
    }
    return "$head · Resets in $countdown"
  }
}

/** Fetches the offer whenever the agent starts or stops being stalled; null while it loads. */
@Composable
fun rememberLimitHandoffOffer(host: ComposerHost, agentId: String, status: RemoteAgentStatus?): Pair<List<LimitHandoffAccount>?, () -> Unit> {
  var accounts by remember(agentId) { mutableStateOf<List<LimitHandoffAccount>?>(emptyList()) }
  val stalled = LimitHandoff.isStalled(status)
  LaunchedEffect(agentId, stalled) {
    if (!stalled) {
      accounts = emptyList()
      return@LaunchedEffect
    }
    accounts = null
    accounts = host.limitHandoffAccounts(agentId)
  }
  return accounts to { accounts = emptyList() }
}
