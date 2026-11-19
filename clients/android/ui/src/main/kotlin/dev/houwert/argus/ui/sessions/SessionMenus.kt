package dev.houwert.argus.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.sessions.SnoozePreset
import dev.houwert.argus.core.sessions.isDone
import dev.houwert.argus.core.sessions.isSnoozed
import dev.houwert.argus.core.stores.ChatHistoryMatch
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.parts
import dev.houwert.argus.core.stores.setPullRequestWatched
import dev.houwert.argus.core.stores.setSessionSettled
import dev.houwert.argus.core.stores.snoozeSession
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.isImported
import dev.houwert.argus.kit.protocol.isOpen
import dev.houwert.argus.kit.protocol.isPinned
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.launch

/** A finished chat: its title, when it ended, how long it ran and, off its session, the branch. */
@Composable
fun StoppedAgentRow(agent: RemoteStoppedAgent, modifier: Modifier = Modifier, showBranch: Boolean = true) {
  val theme = ArgusTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(if (agent.isPinned) Icon.pin else Icon.history, null, Modifier.size(16.dp), tint = theme.accent)
      Text(agent.title, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Text(
        "${Labels.timeAgo(agent.endedAt)} · ${agent.messageCount} messages" + if (showBranch) " · ${agent.branch}" else "",
        Modifier.weight(1f, fill = false), color = theme.textSecondary, style = ArgusTheme.typography.footnote, maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
      if (agent.isImported) Badge("Imported")
    }
  }
}

/** A saved chat's message line that matched the search, its hit in bold. */
@Composable
fun MatchSnippet(match: ChatHistoryMatch, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val role = when (match.role.rawValue) {
    "assistant" -> "Assistant"
    "system" -> "System"
    else -> "You"
  }
  val parts = match.parts
  Text(
    buildAnnotatedString {
      pushStyle(SpanStyle(color = theme.textMuted)); append(role); pop()
      append("  ")
      append(parts.before)
      pushStyle(SpanStyle(color = theme.text, fontWeight = FontWeight.Bold)); append(parts.hit); pop()
      append(parts.after)
    },
    modifier.padding(top = 2.dp), color = theme.textSecondary, style = ArgusTheme.typography.caption, maxLines = 2,
    overflow = TextOverflow.Ellipsis,
  )
}

/**
 * Mark as Done / Move Back to Active, Snooze with its presets, and Watch Pull Request: the items
 * of a session row's long-press menu. [customSnooze] opens the time picker the caller shows.
 */
@Composable
fun SessionRowMenuItems(host: HostStore, session: RemoteSession, dismiss: () -> Unit, customSnooze: () -> Unit) {
  val scope = rememberCoroutineScope()
  fun run(action: suspend () -> Unit) {
    dismiss()
    scope.launch { action() }
  }
  val theme = ArgusTheme.colors
  val pr = session.pullRequest
  if (pr != null && pr.isOpen && host.hasControl) {
    val watching = session.pullRequestWatched == true
    DropdownMenuItem(
      { Text(if (watching) "Stop Watching Pull Request" else "Watch Pull Request") },
      { run { host.setPullRequestWatched(session.id, session.repoRoot, !watching) } },
      leadingIcon = { Icon(if (watching) Icon.eyeSlash else Icon.eye, null, tint = theme.textSecondary) },
    )
  }
  if (!host.hasControl || (session.kind != RemoteSessionKind.worktree && session.kind != RemoteSessionKind.scratchPad)) return
  if (session.isDone) {
    // A merged PR would settle it again; only an explicit "keep" holds it open.
    DropdownMenuItem(
      { Text("Move Back to Active") }, { run { host.setSessionSettled(session, if (pr != null && !pr.isOpen) false else null) } },
      leadingIcon = { Icon(Icon.reopen, null, tint = theme.textSecondary) },
    )
  } else {
    DropdownMenuItem({ Text("Mark as Done") }, { run { host.setSessionSettled(session, true) } }, leadingIcon = { Icon(Icon.done, null, tint = theme.textSecondary) })
  }
  if (session.isSnoozed()) {
    DropdownMenuItem({ Text("Unsnooze") }, { run { host.snoozeSession(session, null) } }, leadingIcon = { Icon(Icon.unsnooze, null, tint = theme.textSecondary) })
  }
  HorizontalDivider()
  for (preset in SnoozePreset.entries) {
    val date = preset.date() ?: continue
    DropdownMenuItem(
      { Text("Snooze ${preset.title.replaceFirstChar { it.lowercase() }}") },
      { run { host.snoozeSession(session, date.toInstant().toEpochMilli()) } },
      leadingIcon = { Icon(Icon.snooze, null, tint = theme.textSecondary) },
    )
  }
  DropdownMenuItem({ Text("Snooze Until") }, { dismiss(); customSnooze() }, leadingIcon = { Icon(Icon.clock, null, tint = theme.textSecondary) })
}

/** Snooze until a day and time of your choosing: a date picker, then a time picker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SnoozeUntilDialog(host: HostStore, session: RemoteSession, onDismiss: () -> Unit) {
  val zone = ZoneId.systemDefault()
  val initial = session.snoozedUntil?.let { Instant.ofEpochMilli(it.toLong()).atZone(zone) }
    ?: SnoozePreset.Tomorrow.date()!!
  val dateState = rememberDatePickerState(
    initialSelectedDateMillis = initial.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
  )
  val timeState = rememberTimePickerState(initial.hour, initial.minute)
  var pickingTime by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val title = SessionActivity.title(session)
  DatePickerDialog(
    onDismissRequest = onDismiss,
    confirmButton = {
      if (pickingTime) {
        TextButton({
          val day = Instant.ofEpochMilli(dateState.selectedDateMillis ?: return@TextButton).atZone(ZoneOffset.UTC).toLocalDate()
          val until = day.atTime(LocalTime.of(timeState.hour, timeState.minute)).atZone(zone).toInstant().toEpochMilli()
          if (until <= System.currentTimeMillis()) return@TextButton
          onDismiss()
          scope.launch { host.snoozeSession(session, until) }
        }) { Text("Snooze") }
      } else {
        TextButton({ pickingTime = true }, enabled = dateState.selectedDateMillis != null) { Text("Next") }
      }
    },
    dismissButton = { TextButton(onDismiss) { Text("Cancel") } },
  ) {
    if (pickingTime) {
      Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Snooze $title until", style = ArgusTheme.typography.headline, maxLines = 1, overflow = TextOverflow.Ellipsis)
        TimePicker(timeState)
        Text("It leaves the list until then, and comes back with a notification.", style = ArgusTheme.typography.footnote, color = ArgusTheme.colors.textSecondary)
      }
    } else {
      DatePicker(dateState, title = { Text("Snooze $title until", Modifier.padding(start = 24.dp, top = 16.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) })
    }
  }
}
