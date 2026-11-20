package dev.houwert.argus.app.screens.compare

import android.graphics.BitmapFactory
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.inbox.TopBarScaffold
import dev.houwert.argus.core.compare.CompareGroup
import dev.houwert.argus.core.compare.CompareLanding
import dev.houwert.argus.core.compare.compareModelName
import dev.houwert.argus.core.compare.compareRunnerName
import dev.houwert.argus.core.compare.compareScreenshot
import dev.houwert.argus.core.compare.compareSessions
import dev.houwert.argus.core.compare.isWorking
import dev.houwert.argus.core.compare.keepCompare
import dev.houwert.argus.core.compare.loadCompare
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.stores.loadRunners
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlot
import dev.houwert.argus.ui.compare.CompareKeepForm
import dev.houwert.argus.ui.compare.CompareSlotCard
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/**
 * A compare run's slots one under another, scored by the computer: what each changed, how its
 * runs and tests stand, what it cost and what its screen shows. "Keep this one" lands the winner.
 */
@Composable
fun CompareRunScreen(groupId: String) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val uri = LocalUriHandler.current
  val host = app.host
  val scope = rememberCoroutineScope()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  host.sessionsByRepo.collectAsState().value
  host.runners.collectAsState().value

  var scores by remember(groupId) { mutableStateOf<List<RemoteCompareSlot>?>(null) }
  val screenshots = remember(groupId) { mutableStateMapOf<String, ImageBitmap>() }
  val loadingScreens = remember(groupId) { mutableStateMapOf<String, Boolean>() }
  var keepingSlot by rememberSaveable { mutableStateOf<String?>(null) }
  var keepingId by remember { mutableStateOf<String?>(null) }

  suspend fun load(screens: Boolean) {
    val loaded = host.loadCompare(groupId)
    if (loaded == null) {
      if (scores == null) scores = emptyList()
      return
    }
    scores = loaded
    // Screens change while an agent works; a finished slot's is read once.
    val wanted = loaded.filter { it.hasScreen && (screens || it.isWorking || it.sessionId !in screenshots) }
    coroutineScope {
      wanted.map { score ->
        loadingScreens[score.sessionId] = true
        async {
          val image = host.compareScreenshot(score.sessionId)?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
          loadingScreens.remove(score.sessionId)
          if (image != null) screenshots[score.sessionId] = image.asImageBitmap()
        }
      }.awaitAll()
    }
  }

  fun route(sessionId: String): Route? =
    host.session(sessionId)?.let { Route.Session(it.id, SessionActivity.title(it), it.repoRoot) }

  LaunchedEffect(groupId) {
    // A deep link can arrive before any list holds the run's sessions.
    if (host.compareSessions(groupId).isEmpty()) {
      host.projects.value.filter { it.repoRoot !in host.sessionsByRepo.value }.forEach { host.loadSessions(it.repoRoot) }
    }
    if (host.runners.value.isEmpty()) host.loadRunners()
    load(screens = true)
  }
  // A settled run's numbers stop moving, so only a working one is asked again.
  val anyWorking = scores?.any { it.isWorking } ?: true
  LiveRefresh(enabled = connection == Transport.State.Ready && anyWorking, interval = 5.seconds) { load(screens = false) }

  val sessions = host.compareSessions(groupId)
  val title = if (sessions.isEmpty()) "Compare" else CompareGroup(groupId, sessions).title
  TopBarScaffold(title, onRefresh = { load(screens = true) }) {
    val current = scores
    when {
      current == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading("Scoring the runs") }
      current.isEmpty() -> EmptyState(Icon.compare, "Compare run gone", body = "Its slots were kept or deleted on the computer.")
      else -> Screen {
        current.forEach { score ->
          CompareSlotCard(
            score, host.compareRunnerName(score.runnerId), host.compareModelName(score.runnerId, score.model),
            onOpen = { route(score.sessionId)?.let(router::push) },
            onKeep = if ("control" in capabilities) ({ keepingSlot = score.sessionId }) else null,
            screenshot = screenshots[score.sessionId],
            loadingScreenshot = loadingScreens[score.sessionId] == true,
            keeping = keepingId == score.sessionId,
          )
        }
      }
    }
  }

  val keeping = scores?.firstOrNull { it.sessionId == keepingSlot }
  if (keeping != null) {
    CompareKeepSheet(
      runner = host.compareRunnerName(keeping.runnerId),
      others = ((scores?.size ?: 1) - 1).coerceAtLeast(0),
      busy = keepingId == keeping.sessionId,
      onDismiss = { if (keepingId == null) keepingSlot = null },
    ) { landing, deleteOthers ->
      scope.launch {
        keepingId = keeping.sessionId
        val kept = host.keepCompare(keeping.sessionId, landing, deleteOthers = deleteOthers)
        keepingId = null
        if (kept == null) return@launch
        keepingSlot = null
        route(keeping.sessionId)?.let {
          // Back skips a run that is gone.
          if (deleteOthers) router.replaceTop(it, 1) else router.push(it)
        }
        kept.pullRequestUrl?.let { url -> runCatching { uri.openUri(url) } }
      }
    }
  }
}

/** How a kept slot lands, the Mac's keep sheet as a bottom sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CompareKeepSheet(runner: String, others: Int, busy: Boolean, onDismiss: () -> Unit, confirm: (CompareLanding, Boolean) -> Unit) {
  val theme = ArgusTheme.colors
  var landing by rememberSaveable { mutableStateOf(CompareLanding.Merge) }
  var deleteOthers by rememberSaveable { mutableStateOf(true) }
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(confirmValueChange = { !busy }),
    containerColor = theme.bg,
    contentColor = theme.text,
  ) {
    Column(Modifier.navigationBarsPadding()) {
      Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(44.dp), contentAlignment = Alignment.Center) {
        AccentLink("Cancel", Modifier.align(Alignment.CenterStart), size = 17, enabled = !busy, onClick = onDismiss)
        Text("Keep this one", color = theme.text, style = ArgusTheme.typography.headline)
        Box(Modifier.align(Alignment.CenterEnd)) {
          if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), color = theme.textMuted, strokeWidth = 2.dp)
          } else {
            AccentLink("Keep", size = 17) { confirm(landing, deleteOthers) }
          }
        }
      }
      Column(Modifier.verticalScroll(rememberScrollState()).padding(ArgusMetrics.space)) {
        CompareKeepForm(landing, { landing = it }, deleteOthers, { deleteOthers = it }, runner, others, enabled = !busy)
      }
    }
  }
}
