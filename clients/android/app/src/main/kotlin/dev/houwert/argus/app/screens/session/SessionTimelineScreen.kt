package dev.houwert.argus.app.screens.session

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.git.SessionTimeline
import dev.houwert.argus.core.git.TimelineEntry
import dev.houwert.argus.core.git.TimelineRestore
import dev.houwert.argus.core.git.TimelineTurn
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.loadTimeline
import dev.houwert.argus.core.stores.restoreTurn
import dev.houwert.argus.core.stores.trackTimelineOpened
import dev.houwert.argus.core.stores.undoRestore
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon as Glyph
import dev.houwert.argus.ui.session.TimelineRestoreRow
import dev.houwert.argus.ui.session.TimelineTurnRow
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.seconds

/**
 * A session's versions, as the Mac's Timeline: one row per agent turn, newest
 * first, with the restores between them. A turn opens its diff; with control,
 * long-press one to put the files back to where it ended.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionTimelineScreen(route: Route.Timeline) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  var timeline by remember { mutableStateOf(SessionTimeline()) }
  var loaded by remember { mutableStateOf(false) }
  var failure by remember { mutableStateOf<String?>(null) }
  var working by remember { mutableStateOf(false) }
  var refreshing by remember { mutableStateOf(false) }
  var restoring by remember { mutableStateOf<TimelineTurn?>(null) }
  var tracked by remember { mutableStateOf(false) }

  suspend fun refresh() {
    try {
      val next = host.loadTimeline(route.sessionId)
      timeline = next
      failure = null
      if (!tracked) {
        tracked = true
        host.trackTimelineOpened(next.turns.size)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e)) failure = HostStore.describe(e)
    }
    loaded = true
  }

  fun act(block: suspend () -> Unit) {
    working = true
    scope.launch {
      try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { host.report(e, "git:timeline") }
      refresh()
      working = false
    }
  }

  LaunchedEffect(route.sessionId) { refresh() }
  LiveRefresh(enabled = connection == Transport.State.Ready, interval = 10.seconds) { refresh() }

  AppScreen("Timeline · ${route.label}") {
    PullToRefreshBox(
      isRefreshing = refreshing,
      onRefresh = { scope.launch { refreshing = true; refresh(); refreshing = false } },
      modifier = Modifier.fillMaxSize(),
    ) {
      LoadPhaseBox(
        loaded = loaded,
        error = failure,
        isEmpty = timeline.turns.isEmpty(),
        modifier = Modifier.fillMaxSize(),
        loadingLabel = "Reading the timeline",
        failedTitle = "Couldn't load the timeline",
        onRetry = { scope.launch { refresh() } },
        empty = {
          EmptyState(
            Glyph.timeline,
            "No turns yet",
            body = "Each prompt an agent runs in this session shows up here, with what it changed.",
          )
        },
      ) {
        val canRestore = { turn: TimelineTurn -> hasControl && turn.canRestore && !timeline.busy && !working }
        LazyColumn(Modifier.fillMaxSize()) {
          if (timeline.busy && hasControl) {
            item("busy") { BusyNote() }
          }
          items(timeline.entries, key = { it.id }) { entry ->
            when (entry) {
              is TimelineEntry.Turn -> TurnItem(
                entry.turn,
                enabled = !working,
                open = { router.push(Route.TurnChanges(route.sessionId, route.label, entry.turn.checkpointId)) },
                restore = if (canRestore(entry.turn)) ({ restoring = entry.turn }) else null,
              )
              is TimelineEntry.Restore -> RestoreItem(
                entry.restore,
                undo = if (entry.restore.canUndo && hasControl && !timeline.busy && !working) {
                  { act { host.undoRestore(route.sessionId, entry.restore.id) } }
                } else null,
              )
            }
            HorizontalDivider(Modifier.padding(start = 46.dp), color = ArgusTheme.colors.borderSubtle)
          }
          item("footer") {
            MutedText(
              "Restoring puts back the files only; the conversation stays as it is.",
              Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
          }
        }
      }
    }
  }

  restoring?.let { turn ->
    ConfirmDialog(
      title = "Restore to the end of turn ${turn.number}?",
      message = "The session's files go back to how they were when turn ${turn.number} ended. " +
        "The conversation stays as it is, and you can undo this right after.",
      confirmLabel = "Restore to this version",
      onConfirm = { act { host.restoreTurn(route.sessionId, turn.checkpointId) } },
      onDismiss = { restoring = null },
    )
  }
}

@Composable
private fun BusyNote() {
  val theme = ArgusTheme.colors
  Row(
    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Icon(Glyph.agent, null, Modifier.size(14.dp), tint = theme.textSecondary)
    Text("An agent is working. Restoring waits until it stops.", style = argusFont(13), color = theme.textSecondary)
  }
}

/** Tap opens the turn's changes; long-press offers the restore, as the phone's context menu does. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TurnItem(turn: TimelineTurn, enabled: Boolean, open: () -> Unit, restore: (() -> Unit)?) {
  var menu by remember { mutableStateOf(false) }
  Box {
    TimelineTurnRow(
      turn,
      Modifier
        .fillMaxWidth()
        .combinedClickable(
          enabled = enabled && (turn.available || restore != null),
          onClickLabel = "Open changes",
          onLongClickLabel = if (restore != null) "Restore to this version" else null,
          onLongClick = restore?.let { { menu = true } },
          onClick = { if (turn.available) open() else menu = restore != null },
        )
        .semantics {
          if (restore != null) customActions = listOf(CustomAccessibilityAction("Restore to this version") { restore(); true })
        }
        .padding(horizontal = 16.dp, vertical = 10.dp),
    )
    DropdownMenu(menu, { menu = false }, containerColor = ArgusTheme.colors.surface) {
      DropdownMenuItem(
        text = { Text("Restore to this version", style = argusFont(15)) },
        leadingIcon = { Icon(Glyph.restoreVersion, null, Modifier.size(18.dp)) },
        onClick = {
          menu = false
          restore?.invoke()
        },
      )
    }
  }
}

@Composable
private fun RestoreItem(restore: TimelineRestore, undo: (() -> Unit)?) {
  TimelineRestoreRow(restore, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), undo)
}
