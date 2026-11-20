package dev.houwert.argus.ui.transcript

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.transcript.WorkLog
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A turn's work folded into one quiet line that opens in place. A decision waiting inside keeps it open. */
@Composable
fun WorkLogRow(log: WorkLog, expanded: Boolean, onExpandedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, onOpen: (Boolean) -> Unit = {}) {
  val theme = ArgusTheme.colors
  val env = transcriptEnvironment
  val pending = LocalPending.current
  val statuses by env.host.statusByAgent.collectAsState()
  // Still at it: the newest thing in a running chat, or a background agent it launched is.
  val working = log.stillRunning != null || (log.ended == null && statuses[env.agentKey]?.status == RemoteAgentStatusStatus.running)
  val awaitsDecision = log.messages.any { message -> message.toolCalls.any(pending::hasPendingCall) }
  val open = expanded || awaitsDecision
  val now = rememberNow(working)
  val label = log.label(working, now)
  val turn by animateFloatAsState(if (open) 90f else 0f, label = "chevron")
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(
      Modifier.fillMaxWidth().heightIn(min = 28.dp)
        .argusClickable(rememberInteraction(), enabled = !awaitsDecision) {
          val next = !expanded
          onExpandedChange(next)
          if (next) onOpen(working)
        }
        .semantics(mergeDescendants = true) {
          contentDescription = "$label, ${log.callCountLabel}"
          stateDescription = if (open) "expanded" else "collapsed"
        },
      horizontalArrangement = Arrangement.spacedBy(4.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(label, color = theme.textMuted, style = argusFont(12))
      Icon(Icon.chevronRight, null, Modifier.size(11.dp).rotate(turn), tint = theme.textMuted)
    }
    if (open) for (message in log.messages) TranscriptMessageView(message)
    Box(Modifier.fillMaxWidth().height(1.dp).background(theme.borderSubtle))
  }
}
