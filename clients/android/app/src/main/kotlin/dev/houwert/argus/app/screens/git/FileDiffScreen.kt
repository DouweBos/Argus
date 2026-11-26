package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.padding
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
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.core.git.AttributionCounts
import dev.houwert.argus.core.git.DiffReviewComment
import dev.houwert.argus.core.git.LineAttribution
import dev.houwert.argus.core.git.addedLineNumbers
import dev.houwert.argus.core.git.SessionDiffScope
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.ViewedFiles
import dev.houwert.argus.core.stores.addReviewComment
import dev.houwert.argus.core.stores.deleteReviewComment
import dev.houwert.argus.core.stores.loadDiff
import dev.houwert.argus.core.stores.loadLineAttribution
import dev.houwert.argus.core.stores.loadSessionTurns
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteSessionTurn
import dev.houwert.argus.kit.util.DiffFile
import dev.houwert.argus.kit.util.DiffFileStatus
import dev.houwert.argus.kit.util.DiffParser
import dev.houwert.argus.ui.components.AttributionLegend
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ChangedFileRow
import dev.houwert.argus.ui.components.DiffHunksView
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.ReviewableDiffHunksView
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.ViewedToggle
import dev.houwert.argus.ui.components.firstChangedLine
import dev.houwert.argus.ui.icons.Icon as Icons
import dev.houwert.argus.ui.theme.Tone
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.launch

/** Sessions whose marks were counted this launch: a refresh every few seconds isn't a new look. */
private val attributionSeen = mutableSetOf<String>()

/** The comment sheet: a new comment on a line, or an edit of a draft. */
internal class Composing(val comment: DiffReviewComment, val isNew: Boolean)

/** One changed file from the Changes list: its row, then every hunk in full, each line open to a comment. */
@Composable
fun FileDiffScreen(sessionId: String, path: String, mode: String) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val control = hasControl()
  val connection by host.connection.collectAsState()
  val drafts by host.reviews.bySession.collectAsState()
  var file by remember { mutableStateOf<DiffFile?>(null) }
  var loaded by remember { mutableStateOf(false) }
  var failure by remember { mutableStateOf<String?>(null) }
  var composing by remember { mutableStateOf<Composing?>(null) }
  var turns by remember { mutableStateOf(emptyList<RemoteSessionTurn>()) }
  var attribution by remember { mutableStateOf(LineAttribution()) }
  // Viewed marks belong to the branch and the working copy; a turn is a look back.
  val viewed = remember(sessionId, mode) { if (mode.startsWith("turn")) null else ViewedFiles(ViewedFiles.Scope.Session(sessionId, mode), host) }
  val viewedStates by (viewed?.states ?: NoMarks).collectAsState()
  val viewedError = viewed?.error?.collectAsState()?.value
  val reviewScope = SessionDiffScope.fromMode(mode, turns).reviewScope(turns)

  suspend fun refresh() {
    viewed?.load()
    try {
      if (mode.startsWith("turn") && turns.isEmpty()) runCatching { host.loadSessionTurns(sessionId) }.getOrNull()?.let { turns = it }
      val (wireMode, checkpoint) = SessionDiffScope.wire(mode)
      file = DiffParser.parse(host.loadDiff(sessionId, wireMode, checkpoint)).firstOrNull { it.displayPath == path }
      // Marks only fit diffs that end at the files as they are now.
      if (LineAttribution.appliesToDiffMode(wireMode)) {
        runCatching { host.loadLineAttribution(sessionId) }.getOrNull()?.let { loaded ->
          attribution = loaded
          if (loaded.files.isNotEmpty() && attributionSeen.add(sessionId)) {
            Telemetry.capture(TelemetryEvent.LineAttributionShown(loaded.files.size))
          }
        }
      }
      failure = null
      loaded = true
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e)) failure = HostStore.describe(e)
    }
  }

  LaunchedEffect(sessionId, path, mode) { refresh() }
  LiveRefresh(connection == Transport.State.Ready, 5.seconds) { refresh() }

  val router = dev.houwert.argus.app.LocalRouter.current
  val viewFile = file?.takeIf { control && it.status != DiffFileStatus.DELETED }?.let { current ->
    listOf(BarAction("View file", Icons.file) { router.push(dev.houwert.argus.app.navigation.Route.File(sessionId, path, current.firstChangedLine, "changes")) })
  }.orEmpty()
  GitScaffold(path.substringAfterLast('/'), viewFile, bottomBar = { SessionReviewBar(sessionId) }) {
    Screen {
      val current = file
      val error = failure
      when {
        current != null -> {
          ChangedFileRow(current, showsChevron = false)
          if (current.status == DiffFileStatus.RENAMED) MutedText("from ${current.oldPath}", maxLines = 1)
          if (viewed != null) {
            ViewedToggle(viewedStates[current.displayPath], if (control) { on -> scope.launch { viewed.set(current.displayPath, on) } } else null)
            viewedError?.let { Banner(it, tone = Tone.Danger) }
          }
          val marks = attribution.lines(current.displayPath)
          if (marks.isNotEmpty()) AttributionLegend(AttributionCounts.of(marks, current.addedLineNumbers))
          if (control) {
            ReviewableDiffHunksView(
              current, drafts[sessionId].orEmpty().filter { it.path == current.displayPath },
              onTapLine = { hunk, line ->
                DiffReviewComment.draft(current.displayPath, hunk, line, reviewScope)?.let { composing = Composing(it, isNew = true) }
              },
              onEdit = { composing = Composing(it, isNew = false) },
              onDelete = { host.deleteReviewComment(it.id, sessionId) },
              attribution = marks,
            )
          } else {
            DiffHunksView(current, collapsesLongHunks = false, attribution = marks)
          }
        }
        error != null ->
          EmptyState(Icons.warning, "Couldn't load changes", body = error, selectable = true) {
            Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icons.refresh) { scope.launch { refresh() } }
          }
        loaded -> EmptyState(Icons.branch, "No changes", Modifier.padding(vertical = 24.dp), body = "This file no longer differs.")
        else -> Loading("Loading changes")
      }
    }
  }
  composing?.let { c ->
    CommentSheet(c, onDismiss = { composing = null }) { body ->
      if (c.isNew) host.addReviewComment(c.comment.copy(body = body), sessionId) else host.reviews.update(c.comment.id, body, sessionId)
    }
  }
}

/** Writing or editing one diff comment. */
@Composable
internal fun CommentSheet(composing: Composing, onDismiss: () -> Unit, onSubmit: (String) -> Unit) {
  TextSheet(
    if (composing.isNew) "Line ${composing.comment.lines.first}" else "Edit comment",
    if (composing.isNew) "Add" else "Save",
    initial = composing.comment.body,
    placeholder = "What should change here?",
    onDismiss = onDismiss,
    onSubmit = onSubmit,
  )
}
