package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.core.search.HostSearch
import dev.houwert.argus.core.search.HostSearchResult
import dev.houwert.argus.core.stores.loadRecentAgents
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.ChromeSearchField
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsLinkRow
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.SettingsRowIcon
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.icons.Icon

/** `/search`: agents, sessions and teammates on the computer by name, matched as the Mac's command palette matches. */
@Composable
fun SearchScreen(initialQuery: String = "") {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val connection by host.connection.collectAsState()
  // Collected so results follow the lists as they load.
  val agents by host.recentAgents.collectAsState()
  val sessions by host.sessionsByRepo.collectAsState()
  val pads by host.scratchPads.collectAsState()
  val teammates by app.teammates.teammates.collectAsState()
  var query by remember { mutableStateOf(initialQuery) }
  var counted by remember { mutableStateOf(false) }
  val items = remember(agents, sessions, pads, teammates) { HostSearch.items(host, teammates.map { it.teammate }) }
  val results = remember(query, items) { HostSearch.results(query, items) }

  LaunchedEffect(connection) {
    if (connection != Transport.State.Ready) return@LaunchedEffect
    host.loadRecentAgents()
    app.teammates.refresh()
    for (project in host.projects.value) if (host.sessionsByRepo.value[project.repoRoot] == null) host.loadSessions(project.repoRoot)
  }
  // Counted once per visit: a tapped result, or a search left without one.
  val left by rememberUpdatedState(Triple(counted, query, results.size))
  DisposableEffect(Unit) {
    onDispose {
      val (done, typed, count) = left
      if (!done && typed.isNotBlank()) Telemetry.capture(TelemetryEvent.SearchUsed(null, count))
    }
  }

  fun open(result: HostSearchResult) {
    counted = true
    Telemetry.capture(TelemetryEvent.SearchUsed(result.kind, results.size))
    router.push(
      when (result.kind) {
        HostSearchResult.Kind.Agent -> Route.Agent(result.itemId, result.title)
        HostSearchResult.Kind.Session -> Route.Session(result.itemId, result.title, result.repoRoot.orEmpty())
        HostSearchResult.Kind.Teammate -> Route.Teammate(result.itemId, result.title)
      },
    )
  }

  TopBarScreen("Search", onBack = router::pop) {
    Column(Modifier.fillMaxSize()) {
      ChromeSearchField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), placeholder = "Agents, sessions, teammates")
      when {
        query.isBlank() -> EmptyState(Icon.search, "Search", body = "Find an agent, a session or a teammate by name.")
        results.isEmpty() -> EmptyState(Icon.search, "No matches", body = "Nothing on this computer is called that.")
        else -> SettingsPage {
          for ((kind, group) in HostSearch.grouped(results)) {
            SettingsGroup(title = kind.title) {
              for (result in group) {
                SettingsLinkRow(result.title, showsTitle = false, leading = { ResultLabel(result) }) { open(result) }
              }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun ResultLabel(result: HostSearchResult) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    SettingsRowIcon(
      when (result.kind) {
        HostSearchResult.Kind.Agent -> Icon.agent
        HostSearchResult.Kind.Session -> Icon.branch
        HostSearchResult.Kind.Teammate -> Icon.teammates
      },
    )
    Column(Modifier.padding(start = 12.dp)) {
      BodyText(result.title, maxLines = 1)
      result.subtitle?.let { MutedText(it, maxLines = 1) }
    }
  }
}
