package dev.houwert.argus.app.screens.files

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import dev.houwert.argus.core.files.FileSearchQuery
import dev.houwert.argus.core.files.FileSearchStore
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ChromeSearchField
import dev.houwert.argus.ui.components.ControlRequiredBanner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PillGroup
import dev.houwert.argus.ui.components.PillItem
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.files.FileSearchGroupHeader
import dev.houwert.argus.ui.files.FileSearchMatchRow
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Search a session's worktree: results stream in grouped by file, and a tap opens the file at the line. */
@Composable
fun FileSearchScreen(sessionId: String, label: String) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val theme = ArgusTheme.colors
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val store = remember(sessionId) { FileSearchStore(host, sessionId) }
  val phase by store.phase.collectAsState()
  val groups by store.groups.collectAsState()
  val count by store.matchCount.collectAsState()
  var text by remember { mutableStateOf("") }
  var regex by remember { mutableStateOf(false) }
  var caseSensitive by remember { mutableStateOf(false) }
  var wholeWord by remember { mutableStateOf(false) }
  val query = FileSearchQuery(text, regex, caseSensitive, wholeWord)

  // Debounced: a new keystroke cancels the wait, and `run` cancels the last search.
  LaunchedEffect(query, hasControl) { if (hasControl) store.schedule(query) }
  DisposableEffect(store) {
    onDispose { CoroutineScope(SupervisorJob() + Dispatchers.Main).launch { store.cancel(); cancel() } }
  }

  TopBarScreen("Search · $label", onBack = router::pop) {
    Column(Modifier.fillMaxSize()) {
      ChromeSearchField(text, { text = it }, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), placeholder = "Search this worktree")
      if (!hasControl) {
        ControlRequiredBanner("search files", Modifier.padding(16.dp))
        return@Column
      }
      PillGroup(Modifier.padding(horizontal = 12.dp, vertical = 4.dp)) {
        PillItem(null, "Regex", title = "Regex", selected = regex) { regex = !regex }
        PillItem(null, "Match case", title = "Match case", selected = caseSensitive) { caseSensitive = !caseSensitive }
        PillItem(null, "Whole word", title = "Whole word", selected = wholeWord) { wholeWord = !wholeWord }
      }
      when (val p = phase) {
        FileSearchStore.Phase.Idle -> EmptyState(Icon.search, "Search files", body = "Find text across every file in this session.")
        is FileSearchStore.Phase.Done -> if (p.count == 0) EmptyState(Icon.search, "No results", body = "Nothing in this worktree matches.") else Results(sessionId, groups, summary(count, groups.size, p))
        is FileSearchStore.Phase.Failed -> Banner(p.message, Modifier.padding(16.dp), tone = Tone.Danger)
        FileSearchStore.Phase.Running -> if (groups.isEmpty()) Loading("Searching") else Results(sessionId, groups, summary(count, groups.size, p))
      }
    }
  }
}

@Composable
private fun Results(sessionId: String, groups: List<FileSearchStore.Group>, summary: String) {
  val router = LocalRouter.current
  LazyColumn(Modifier.fillMaxSize()) {
    item("summary") { MutedText(summary, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), maxLines = 2) }
    for (group in groups) {
      item("h:${group.path}") { FileSearchGroupHeader(group.path, group.matches.size, Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 4.dp)) }
      items(group.matches.size, key = { "m:${group.path}:$it" }) { i ->
        val match = group.matches[i]
        HomeRow("${group.path} line ${match.line}", onClick = { router.push(Route.File(sessionId, match.relativePath, match.line.toInt(), "search")) }) {
          FileSearchMatchRow(match)
        }
      }
    }
  }
}

private fun summary(count: Int, files: Int, phase: FileSearchStore.Phase): String {
  val base = "$count result${if (count == 1) "" else "s"} in $files file${if (files == 1) "" else "s"}"
  return when {
    phase == FileSearchStore.Phase.Running -> "$base so far"
    phase is FileSearchStore.Phase.Done && phase.truncated -> "$base, stopped at the limit. Refine the search to see the rest."
    else -> base
  }
}
