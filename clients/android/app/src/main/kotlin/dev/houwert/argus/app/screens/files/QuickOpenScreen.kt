package dev.houwert.argus.app.screens.files

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.home.HomeRow
import dev.houwert.argus.core.code.FuzzyFileMatcher
import dev.houwert.argus.core.stores.listFiles
import dev.houwert.argus.core.stores.loadDiff
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.util.DiffFileStatus
import dev.houwert.argus.kit.util.DiffParser
import dev.houwert.argus.ui.components.ChromeSearchField
import dev.houwert.argus.ui.components.ControlRequiredBanner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.files.FuzzyFileRow
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/** Find a session file by name: fuzzy matching over the worktree's files, the ones this session changed first. */
@Composable
fun QuickOpenScreen(sessionId: String, label: String) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val theme = ArgusTheme.colors
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  var matcher by remember { mutableStateOf<FuzzyFileMatcher?>(null) }
  var changed by remember { mutableStateOf(emptySet<String>()) }
  var query by remember { mutableStateOf("") }
  val results = remember(matcher, changed, query) { matcher?.search(query, changed, 100).orEmpty() }

  LaunchedEffect(connection == Transport.State.Ready, hasControl) {
    if (matcher != null || connection != Transport.State.Ready || !hasControl) return@LaunchedEffect
    coroutineScope {
      val files = async { host.listFiles(sessionId) }
      val diff = async { runCatching { host.loadDiff(sessionId, "branch") }.getOrDefault("") }
      val patch = diff.await()
      changed = DiffParser.parse(patch).filter { it.status != DiffFileStatus.DELETED }.map { it.displayPath }.toSet()
      matcher = FuzzyFileMatcher(files.await())
    }
  }

  TopBarScreen("Open File · $label", onBack = router::pop) {
    Column(Modifier.fillMaxSize()) {
      ChromeSearchField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), placeholder = "File name")
      when {
        !hasControl -> ControlRequiredBanner("browse files", Modifier.padding(16.dp))
        matcher == null -> Loading("Listing files")
        results.isEmpty() -> EmptyState(
          Icon.search, "No matching files",
          body = if (query.isEmpty()) "This session has no files." else "Nothing in this worktree matches “$query”.",
        )
        else -> LazyColumn(Modifier.fillMaxSize()) {
          items(results, key = { it.path }) { match ->
            HomeRow(match.path, onClick = { router.push(Route.File(sessionId, match.path, null, "quick_open")) }) { FuzzyFileRow(match) }
            HorizontalDivider(Modifier.padding(start = 40.dp), color = theme.borderSubtle)
          }
        }
      }
    }
  }
}
