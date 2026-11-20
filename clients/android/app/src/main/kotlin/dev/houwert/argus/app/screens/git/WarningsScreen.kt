package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.NotificationsLog
import dev.houwert.argus.core.stores.startTriage
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/**
 * Warnings and errors shown this launch, so a toast that vanished before it was read can
 * still be. The phone's counterpart of the desktop's `/notifications`, over the same log.
 */
@Composable
fun WarningsScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val log = app.notifications
  val entries by log.entries.collectAsState()
  var triaging by remember { mutableStateOf(false) }

  LaunchedEffect(entries) { log.markSeen() }

  fun triage(entry: NotificationsLog.Entry?) {
    triaging = true
    scope.launch {
      val agent = app.host.startTriage(entry?.message, entry?.level?.raw, entry?.source)
      triaging = false
      if (agent != null) router.push(Route.Agent(agent.agentId, Labels.agentName(agent)))
    }
  }

  GitScaffold(
    "Notifications",
    if (entries.isNotEmpty()) listOf(BarAction("Clear", Icons.trash) { log.clear() }) else emptyList(),
  ) {
    if (entries.isEmpty()) {
      EmptyState(Icons.check, "Nothing went wrong", body = "Failures shown while you use the app are kept here until it quits.") {
        if (control) Btn("Triage a problem with Argus", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icons.triage, enabled = !triaging) { triage(null) }
      }
      return@GitScaffold
    }
    Screen {
      ListSection {
        for (entry in entries) {
          NotificationRow(entry, onDismiss = { log.dismiss(entry.id) }, onTriage = if (control) ({ triage(entry) }) else null)
        }
      }
      if (control) {
        ListSection(footer = "A read-only agent on the computer reads its logs, diagnoses the problem and drafts an issue. Nothing is posted until you say so.") {
          dev.houwert.argus.ui.components.ListRow("Triage a problem with Argus", icon = Icons.triage, chevron = false, enabled = !triaging, onClick = { triage(null) })
        }
      }
    }
  }
}

/** One entry; long-press for Dismiss and Triage. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun NotificationRow(entry: NotificationsLog.Entry, onDismiss: () -> Unit, onTriage: (() -> Unit)?) {
  val theme = ArgusTheme.colors
  var open by remember { mutableStateOf(false) }
  val meta = listOfNotNull(
    entry.level.raw, entry.source, if (entry.count > 1) "×${entry.count}" else null, Labels.timeAgo(entry.timestamp.toDouble()),
  ).joinToString(" · ")
  Box {
    Row(
      Modifier.fillMaxWidth()
        .semantics { onLongClick("Notification actions") { open = true; true } }
        .combinedClickable(onClickLabel = "Notification actions", onLongClick = { open = true }) { open = true }
        .padding(horizontal = 16.dp, vertical = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Icon(
        if (entry.level == NotificationsLog.Level.Info) Icons.done else Icons.warning, entry.level.raw, Modifier.size(18.dp),
        tint = when (entry.level) {
          NotificationsLog.Level.Error -> theme.error
          NotificationsLog.Level.Info -> theme.success
          NotificationsLog.Level.Warning -> theme.warning
        },
      )
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SelectionContainer { BodyText(entry.message) }
        MutedText(meta)
      }
    }
    DropdownMenu(open, { open = false }, containerColor = theme.surface) {
      BranchMenuItems(
        listOfNotNull(
          onTriage?.let { BranchMenuEntry.Item("Triage", Icons.triage, run = it) },
          BranchMenuEntry.Item("Dismiss", Icons.close, destructive = true, run = onDismiss),
        ),
      ) { open = false }
    }
  }
}
