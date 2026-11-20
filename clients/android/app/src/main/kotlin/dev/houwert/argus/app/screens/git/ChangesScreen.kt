package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.git.ReviewGuideTarget
import dev.houwert.argus.core.git.SessionDiffScope
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.ViewedFiles
import dev.houwert.argus.core.stores.loadDiff
import dev.houwert.argus.core.stores.loadGitStatus
import dev.houwert.argus.core.stores.loadSessionTurns
import dev.houwert.argus.core.stores.requestCodeReview
import dev.houwert.argus.core.stores.trackDiffScope
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionTurn
import dev.houwert.argus.kit.protocol.generated.RemoteViewedFileState
import dev.houwert.argus.kit.util.DiffParser
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.ChangedFileRow
import dev.houwert.argus.ui.components.DividedColumn
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.ViewedProgressBar
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/** What a diff without viewed marks reads them as. */
internal val NoMarks = MutableStateFlow(emptyMap<String, RemoteViewedFileState>())

/**
 * Review what the agent changed, then land it: the git status summary, the diff by scope
 * (branch, uncommitted, a turn), and commit/push/merge for a device holding `control`.
 */
@Composable
fun ChangesScreen(sessionId: String, label: String, initialMode: String = "branch") {
  val app = LocalAppStore.current
  val host = app.host
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val connection by host.connection.collectAsState()
  val statuses by host.gitStatusBySession.collectAsState()
  host.sessionsByRepo.collectAsState().value

  var mode by rememberSaveable { mutableStateOf(initialMode) }
  var turns by remember { mutableStateOf(emptyList<RemoteSessionTurn>()) }
  var diff by remember { mutableStateOf<String?>(null) }
  var failure by remember { mutableStateOf<String?>(null) }
  var viewed by remember { mutableStateOf<ViewedFiles?>(null) }
  var stackingOn by remember { mutableStateOf<RemoteSession?>(null) }
  val files = remember(diff) { diff?.let(DiffParser::parse).orEmpty() }
  val isTurn = mode.startsWith("turn")

  suspend fun refresh() {
    host.loadGitStatus(sessionId)
    val asked = mode
    if (asked.startsWith("turn")) {
      // Viewed marks belong to the branch and the working copy; a turn is a look back.
      viewed = null
      runCatching { host.loadSessionTurns(sessionId) }.getOrNull()?.let { turns = it }
    } else {
      val wanted = ViewedFiles.Scope.Session(sessionId, asked)
      val marks = viewed?.takeIf { it.scope == wanted } ?: ViewedFiles(wanted, host).also { viewed = it }
      marks.load()
    }
    try {
      val (wireMode, checkpoint) = SessionDiffScope.wire(asked)
      val loaded = host.loadDiff(sessionId, wireMode, checkpoint)
      // A switch of mode mid-load would otherwise get the other mode's diff.
      if (asked != mode) return
      diff = loaded
      failure = null
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e) && asked == mode) failure = HostStore.describe(e)
    }
  }

  LaunchedEffect(mode) {
    diff = null
    failure = null
    refresh()
  }
  LiveRefresh(connection == Transport.State.Ready, 5.seconds) { refresh() }
  val viewedStates by (viewed?.states ?: NoMarks).collectAsState()

  fun setMode(next: String) {
    if (next == mode) return
    mode = next
    host.trackDiffScope(SessionDiffScope.fromMode(next, turns))
  }

  // A file opened from the last turn stays on that turn, even once another starts.
  val pinnedMode = if (mode == "turn") turns.lastOrNull()?.let { SessionDiffScope.Turn(it).mode } ?: mode else mode
  val actions = buildList {
    if (control) {
      add(BarAction("Review code", Icons.sideQuestion, enabled = files.isNotEmpty()) {
        scope.launch {
          val session = host.session(sessionId)
          val base = if (session?.kind == RemoteSessionKind.worktree) session.baseBranch else null
          host.requestCodeReview(sessionId, base)?.let { openAgent(host, router::push, it) }
        }
      })
    }
    add(BarAction("Stashes and tags", Icons.history) { router.push(Route.Stashes(sessionId, label)) })
  }

  GitScaffold("Changes · $label", actions, bottomBar = { SessionReviewBar(sessionId) }) {
    Screen {
      SegmentedControl(if (isTurn) "turn" else mode, listOf("branch" to "Branch", "working" to "Uncommitted", "turn" to "Last turn")) {
        if (it != (if (isTurn) "turn" else mode)) setMode(it)
      }
      if (isTurn) TurnPicker(mode, turns) { setMode(it) }
      statuses[sessionId]?.let { status ->
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          StatusDot(if (status.conflictCount > 0) Tone.Warning else Tone.Accent)
          MutedText(statusLine(status), maxLines = 1)
        }
      }
      val error = failure
      when {
        diff == null && error != null ->
          EmptyState(Icons.warning, "Couldn't load changes", body = error, selectable = true) {
            Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icons.refresh) { scope.launch { refresh() } }
          }
        diff == null -> Loading("Loading changes")
        files.isEmpty() -> EmptyState(Icons.branch, "No changes", Modifier.padding(vertical = 24.dp), body = emptyMessage(mode, turns))
        else -> {
          if (viewed != null) ViewedProgressBar(files.count { viewedStates[it.displayPath] == RemoteViewedFileState.viewed }, files.size)
          if (mode == "branch") Card { ReviewGuideLink(ReviewGuideTarget.Session(sessionId), label) }
          Card {
            DividedColumn(inset = 22.dp) {
              for (file in files) {
                val interaction = rememberInteraction()
                ChangedFileRow(
                  file,
                  Modifier.argusClickable(interaction, label = "Open ${file.displayPath}") { router.push(Route.FileDiff(sessionId, file.displayPath, pinnedMode)) }
                    .padding(vertical = 10.dp),
                  viewedState = viewedStates[file.displayPath],
                )
              }
            }
          }
        }
      }
      if (control) {
        LandWorkCard(
          sessionId, allowsAmend = true, onChanged = { refresh() }, onDeleted = { router.popToRoot() },
          onAgentStarted = { router.push(Route.Agent(it, "Resolve conflicts")) },
        )
        StackCard(sessionId, onNewSessionOnTop = { stackingOn = host.session(sessionId) }, onChanged = { refresh() })
      }
    }
  }
  stackingOn?.let { parent ->
    StackedSessionSheet(parent, onDismiss = { stackingOn = null }) { session ->
      router.push(Route.Session(session.id, SessionActivity.title(session), session.repoRoot))
    }
  }
}

/** Which turn: the latest by default, or any earlier one. */
@Composable
private fun TurnPicker(mode: String, turns: List<RemoteSessionTurn>, onPick: (String) -> Unit) {
  val theme = ArgusTheme.colors
  var open by remember { mutableStateOf(false) }
  val turn = SessionDiffScope.fromMode(mode, turns).turn(turns)
  val label = if (turn == null) "No turns yet" else {
    val which = if (mode == "turn") "Last turn (${turn.number})" else "Turn ${turn.number}"
    if (turn.prompt.isEmpty()) which else "$which · ${turn.prompt}"
  }
  Box {
    val interaction = rememberInteraction()
    Row(
      Modifier.fillMaxWidth().argusClickable(interaction, enabled = turns.isNotEmpty(), label = "Pick a turn") { open = true }.padding(vertical = 6.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      MutedText(label, Modifier.weight(1f, fill = false), maxLines = 1)
      Icon(Icons.chevronDown, null, Modifier.size(12.dp), tint = theme.textMuted)
    }
    DropdownMenu(open, { open = false }, containerColor = theme.surface) {
      DropdownMenuItem({ Text("Last turn", style = argusFont(15)) }, {
        open = false
        onPick("turn")
      })
      for (t in turns.reversed()) {
        DropdownMenuItem({ Text("Turn ${t.number} · ${t.prompt}", style = argusFont(15), maxLines = 1) }, {
          open = false
          onPick(SessionDiffScope.Turn(t).mode)
        })
      }
    }
  }
}

private fun emptyMessage(mode: String, turns: List<RemoteSessionTurn>) = when (mode) {
  "branch" -> "This session has no changes vs its base branch. Try Uncommitted for working-tree edits."
  "working" -> "No uncommitted changes in the working tree."
  else -> if (turns.isEmpty()) "No agent has run a prompt in this session yet." else "This turn didn't change any files."
}

private fun statusLine(status: RemoteGitStatus): String {
  val parts = mutableListOf(status.branch)
  if (status.ahead > 0) parts += "↑${status.ahead.toInt()}"
  if (status.behind > 0) parts += "↓${status.behind.toInt()}"
  // The working tree, whichever diff is on screen: say so.
  parts += if (status.dirtyCount > 0) "${status.dirtyCount.toInt()} uncommitted" else "nothing uncommitted"
  if (status.conflictCount > 0) parts += "${status.conflictCount.toInt()} conflicts"
  return parts.joinToString(" · ")
}
