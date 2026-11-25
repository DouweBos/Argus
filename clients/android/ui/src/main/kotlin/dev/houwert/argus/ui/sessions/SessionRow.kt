package dev.houwert.argus.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.compare.CompareGroup
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.sessions.isSnoozed
import dev.houwert.argus.core.sessions.setStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.isUnavailable
import dev.houwert.argus.ui.components.ChangeCounts
import dev.houwert.argus.ui.components.ChromeText
import dev.houwert.argus.ui.components.PullRequestLabels
import dev.houwert.argus.ui.components.PullRequestStateIcon
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

val SessionActivity.State.tone: Tone
  get() = when (this) {
    SessionActivity.State.Failed -> Tone.Danger
    SessionActivity.State.Waiting -> Tone.Warning
    SessionActivity.State.Working, SessionActivity.State.Unread -> Tone.Accent
    else -> Tone.Muted
  }

val SessionActivity.tone: Tone get() = state.tone

private const val INDENT_STEP = 16

/**
 * One session as a row: a dot when something's happening, its title, a line for setup, errors or its
 * status note, its set status, and how long ago its agents were last active. [detailed] also names the branch and agent count.
 */
@Composable
fun SessionRow(
  session: RemoteSession,
  agents: List<RemoteAgentStatus>,
  modifier: Modifier = Modifier,
  git: RemoteGitStatus? = null,
  detailed: Boolean = false,
  caption: String? = null,
  title: String? = null,
  indent: Int = 0,
  stacked: Boolean = false,
) {
  val theme = ArgusTheme.colors
  val activity = SessionActivity(session, agents)
  val detail = when {
    session.isUnavailable -> "${session.unavailableVolume ?: "Drive"} unavailable"
    session.status != RemoteSessionStatus.ready -> activity.statusText
    !detailed -> listOfNotNull(caption, session.statusNote).joinToString(" · ").ifEmpty { null }
    else -> listOfNotNull(caption, session.statusNote, activity.subtitle, activity.statusText).joinToString(" · ").ifEmpty { null }
  }
  Row(
    modifier.fillMaxWidth().alpha(if (session.isUnavailable) 0.5f else 1f).padding(start = (indent * INDENT_STEP).dp)
      .padding(vertical = if (detailed) 2.dp else 4.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.width(8.dp), contentAlignment = Alignment.Center) {
      if (stacked && indent > 0) {
        Icon(Icon.stacked, "Stacked", Modifier.size(12.dp).padding(end = 0.dp), tint = theme.textMuted)
      } else if (activity.showsDot) {
        StatusDot(activity.tone, pulse = activity.isBusy && !session.isUnavailable)
      }
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (detailed) 2.dp else 1.dp)) {
      Text(title ?: activity.title, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (detail != null) {
        Text(
          detail, color = if (session.status == RemoteSessionStatus.error) theme.error else theme.textMuted,
          style = ArgusTheme.typography.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
      }
    }
    SessionRowTrailing(session, activity, git, detailed)
  }
}

@Composable
private fun SessionRowTrailing(session: RemoteSession, activity: SessionActivity, git: RemoteGitStatus?, detailed: Boolean) {
  val theme = ArgusTheme.colors
  val fraction = session.progress?.let { if (it.total > 0) it.current / it.total else null }
  when {
    fraction != null && session.status != RemoteSessionStatus.ready ->
      CircularProgressIndicator({ fraction.toFloat() }, Modifier.size(14.dp), color = theme.accent, strokeWidth = 2.dp, trackColor = theme.border)
    session.isUnavailable -> Icon(Icon.drive, null, Modifier.size(14.dp), tint = theme.textMuted)
    else -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      if (session.isSnoozed()) Icon(Icon.snooze, "Snoozed", Modifier.size(13.dp), tint = theme.textMuted)
      session.setStatus?.let { SessionStatusGlyph(it, size = 14.dp) }
      if (git != null) SyncCounts(git)
      session.pullRequest?.let { pr ->
        val watching = session.pullRequestWatched == true
        PullRequestStateIcon(pr.state, PullRequestLabels.state(pr, watching), size = 14.dp, watching = watching)
      }
      if (detailed && git != null) {
        val additions = git.diffAdditions
        val deletions = git.diffDeletions
        if (additions != null && deletions != null) ChangeCounts(additions.toInt(), deletions.toInt())
      }
      activity.lastActive?.let {
        Text(ChromeText.shortAge(it), color = theme.textMuted, style = ArgusTheme.typography.footnote, maxLines = 1, softWrap = false)
      }
    }
  }
}

/** Commits behind and ahead of the upstream: ↓ in warning, ↑ muted. Nothing when level or without one. */
@Composable
fun SyncCounts(status: RemoteGitStatus, modifier: Modifier = Modifier) {
  val upstream = status.upstream ?: return
  val ahead = status.ahead.toInt()
  val behind = status.behind.toInt()
  if (ahead <= 0 && behind <= 0) return
  val theme = ArgusTheme.colors
  val label = listOfNotNull(
    if (behind > 0) "$behind commit${if (behind == 1) "" else "s"} behind $upstream" else null,
    if (ahead > 0) "$ahead commit${if (ahead == 1) "" else "s"} ahead of $upstream" else null,
  ).joinToString(", ")
  Row(modifier.clearAndSetSemantics { contentDescription = label }, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    if (behind > 0) Text("↓$behind", color = theme.warning, style = argusFont(12, FontWeight.Medium, mono = true))
    if (ahead > 0) Text("↑$ahead", color = theme.textMuted, style = argusFont(12, FontWeight.Medium, mono = true))
  }
}

/** A section's quiet header: its title, a rule, and an optional trailing control. */
@Composable
fun SidebarSectionHeader(title: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null) {
  val theme = ArgusTheme.colors
  Row(modifier.fillMaxWidth().heightIn(min = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(title, color = theme.textMuted, style = argusFont(13, FontWeight.Medium))
    Box(Modifier.weight(1f).height(1.dp).background(theme.border))
    trailing?.invoke()
  }
}

/** "2 done · 1 snoozed" behind a chevron: the row that unfolds a project's done and snoozed sessions. */
@Composable
fun FoldedSessionsLabel(label: String, expanded: Boolean, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(
    modifier.fillMaxWidth().semantics(mergeDescendants = true) { stateDescription = if (expanded) "Expanded" else "Collapsed" },
    horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(if (expanded) Icon.chevronDown else Icon.chevronRight, null, Modifier.size(10.dp), tint = theme.textMuted)
    Text(label, color = theme.textMuted, style = ArgusTheme.typography.footnote)
  }
}

/** A project's root checkout in its header: the branch, with a dot while its agents work. */
@Composable
fun ProjectRootState(activity: SessionActivity, branch: String, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(modifier.widthIn(max = 110.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
    if (activity.showsDot) StatusDot(activity.tone, pulse = activity.isBusy)
    Text(
      branch, color = if (activity.session.status == RemoteSessionStatus.error) theme.error else theme.textMuted,
      style = ArgusTheme.typography.caption, maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
    )
  }
}

/** A compare run's row in a session list, above its slots: the prompt's name and how many ran it. */
@Composable
fun CompareRunHeaderRow(run: CompareGroup, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(
    modifier.fillMaxWidth().padding(vertical = 2.dp)
      .clearAndSetSemantics { contentDescription = "Compare run, ${run.title}, ${run.sessions.size} runners" },
    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(Icon.compare, null, Modifier.size(14.dp), tint = theme.accent)
    Text(run.title, Modifier.weight(1f), color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    Text("×${run.sessions.size}", color = theme.textMuted, style = ArgusTheme.typography.footnote)
  }
}
