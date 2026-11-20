package dev.houwert.argus.app.screens.issues

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.LinearIssueBoard
import dev.houwert.argus.core.stores.LinearIssuesModel
import dev.houwert.argus.core.stores.all
import dev.houwert.argus.core.stores.isConnected
import dev.houwert.argus.core.stores.integrations
import dev.houwert.argus.core.stores.loadIntegrations
import dev.houwert.argus.core.stores.title
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.IntegrationId
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.integrations.IssueFilterBar
import dev.houwert.argus.ui.integrations.LinearIssuesList
import dev.houwert.argus.ui.integrations.LinearIssuesPlaceholder
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlin.time.Duration.Companion.minutes
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import dev.houwert.argus.ui.components.TitleBar
import dev.houwert.argus.app.screens.backAction

/**
 * The computer's open Linear issues, as the desktop's `/issues`: assigned to, created by or
 * subscribed to by you, a section per status, or a search of the whole workspace. Tapping one opens it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssuesScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val theme = ArgusTheme.colors
  val model = remember(host) { LinearIssuesModel(host, app.preferences) }
  val scope = rememberCoroutineScope()
  val connection by host.connection.collectAsState()
  val integrations by host.integrations.collectAsState()
  val connected = integrations.isConnected(IntegrationId.linear)
  val issueScope by model.scope.collectAsState()
  val query by model.query.collectAsState()
  val issues by model.issues.collectAsState()
  val shown by model.shownIssues.collectAsState()
  val error by model.error.collectAsState()
  val filters by model.filters.collectAsState()
  val states by model.workflowStates.collectAsState()
  val refreshing by model.refreshing.collectAsState()
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  var searchText by rememberSaveable { mutableStateOf("") }
  val ready = connection == Transport.State.Ready

  LaunchedEffect(searchText) {
    val term = LinearIssuesModel.term(searchText)
    if (term == model.query.value) return@LaunchedEffect
    if (term != null) delay(300)
    model.setQuery(term)
  }
  LaunchedEffect(ready, issueScope, query) {
    if (!ready) return@LaunchedEffect
    host.loadIntegrations()
    model.refresh()
  }
  LiveRefresh(enabled = ready && connected, interval = 5.minutes) { model.refresh() }

  Column(Modifier.fillMaxSize().background(theme.bg)) {
    TitleBar("Issues", onBack = backAction())
    if (connected) {
      Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        ThemedTextField(searchText, { searchText = it }, "Search all issues", input = TextInput.Code)
        // Results come from the whole workspace, not a scope.
        if (query == null) {
          SegmentedControl(issueScope, LinearIssueScope.all.map { it to it.title }) { model.setScope(it) }
        }
        if (!issues.isNullOrEmpty()) IssueFilterBar(issues.orEmpty(), filters, model::setFilters, states = states)
      }
    }
    PullToRefreshBox(refreshing, { scope.launch { model.refresh() } }, Modifier.fillMaxWidth().weight(1f)) {
      val list = shown
      if (connected && !list.isNullOrEmpty()) {
        val sessions = sessionsByRepo.values.flatten()
        LinearIssuesList(
          list,
          agentOnIt = { LinearIssueBoard.session(it, sessions) != null },
          onOpen = { router.push(Route.Issue(it.identifier)) },
          error = error,
          contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp),
        )
      } else {
        Box(Modifier.fillMaxSize()) {
          LinearIssuesPlaceholder(
            connected, "Connect Linear in Argus on your computer to see your issues here.", issueScope, query, issues, shown, error,
          )
        }
      }
    }
  }
}
