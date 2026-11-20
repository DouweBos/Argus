package dev.houwert.argus.ui.session

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.sessions.SessionFact
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.components.ChromeText
import dev.houwert.argus.ui.components.PullRequestStateIcon
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon as Glyph
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

object SessionDetailsText {
  /** GitLab numbers merge requests with `!`, GitHub pull requests with `#`. */
  fun pullRequestRef(pr: SessionPullRequest): String =
    (if ("gitlab" in pr.url.lowercase()) "!" else "#") + pr.number.toInt()

  fun chatDetail(chat: RemoteStoppedAgent, now: Double = System.currentTimeMillis().toDouble()): String {
    val messages = chat.messageCount.toInt().let { if (it == 1) "1 message" else "$it messages" }
    return "${Labels.timeAgo(chat.endedAt, now)} · $messages"
  }
}

/** A session fact's value, as the details' Status section and the Mac's hover card show it. */
@Composable
fun SessionFactValue(fact: SessionFact, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val color = when (fact.emphasis) {
    SessionFact.Emphasis.Danger -> theme.error
    SessionFact.Emphasis.Warning -> theme.warning
    SessionFact.Emphasis.None -> theme.textSecondary
  }
  @Composable
  fun label(text: String, mono: Boolean) =
    Text(text, modifier, style = argusFont(15, mono = mono), color = color, maxLines = 2, overflow = TextOverflow.MiddleEllipsis)
  when (val value = fact.value) {
    is SessionFact.Value.Changes -> ChangeCounts(value.additions, value.deletions, modifier)
    is SessionFact.Value.Text -> label(value.text, mono = false)
    is SessionFact.Value.Ref -> label(value.ref, mono = true)
    is SessionFact.Value.Age -> label("${ChromeText.shortAge(value.millis)} ago", mono = false)
    is SessionFact.Value.PullRequest -> {
      val uri = LocalUriHandler.current
      val pr = value.pullRequest
      val interaction = rememberInteraction()
      Row(
        modifier.argusClickable(interaction, label = "Open ${SessionDetailsText.pullRequestRef(pr)}") { runCatching { uri.openUri(pr.url) } },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
      ) {
        PullRequestStateIcon(pr.state, SessionDetailsText.pullRequestRef(pr), size = 12.dp)
        Text(SessionDetailsText.pullRequestRef(pr), style = argusFont(15), color = theme.accent)
      }
    }
  }
}

/** A label on the left, its value on the right: one row of the details' Status section. */
@Composable
fun SessionFactRow(fact: SessionFact, modifier: Modifier = Modifier) {
  Row(
    modifier.fillMaxWidth().heightIn(min = ArgusMetrics.minTouchTarget).padding(horizontal = 16.dp, vertical = 11.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Text(fact.label, Modifier.weight(1f), style = ArgusTheme.typography.body, color = ArgusTheme.colors.text)
    SessionFactValue(fact)
  }
}

/** An ended chat from the session's branch: its title, when it ended and how long it ran. */
@Composable
fun RecentChatRow(chat: RemoteStoppedAgent, onClick: () -> Unit, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Row(
    modifier
      .fillMaxWidth()
      .heightIn(min = ArgusMetrics.minTouchTarget)
      .argusClickable(interaction, label = chat.title, onClick = onClick)
      .padding(horizontal = 16.dp, vertical = 9.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Icon(Glyph.history, null, Modifier.size(20.dp), tint = theme.textSecondary)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(chat.title, style = ArgusTheme.typography.body, color = theme.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(SessionDetailsText.chatDetail(chat), style = ArgusTheme.typography.footnote, color = theme.textSecondary, maxLines = 1)
    }
    Icon(Glyph.chevronRight, null, Modifier.size(18.dp), tint = theme.textMuted)
  }
}
