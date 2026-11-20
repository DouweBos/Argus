package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.grouping
import dev.houwert.argus.core.stores.groupingFlow
import dev.houwert.argus.core.stores.loadRecentAgents
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.sessions.AgentStatusRow
import dev.houwert.argus.ui.sessions.agentsSummary
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.launch

/** `/agents`: every agent on the computer, across projects, the ones working or waiting on you first. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentsScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val theme = ArgusTheme.colors
  val grouping by host.groupingFlow.collectAsState(host.grouping)
  val loaded by host.recentAgentsLoaded.collectAsState()
  val connection by host.connection.collectAsState()
  val scope = rememberCoroutineScope()
  var refreshing by remember { mutableStateOf(false) }
  val agents = grouping.recentAgentsByActivity

  // Status events only reach agents this phone is subscribed to, so a list of every agent polls.
  LiveRefresh(connection == Transport.State.Ready, 5.seconds) { host.loadRecentAgents() }

  TopBarScreen("Agents") {
    when {
      agents.isEmpty() && !loaded -> Loading("Reading agents")
      agents.isEmpty() -> EmptyState(Icon.agent, "No agents", body = "Start one from a session to see it here.")
      else -> PullToRefreshBox(refreshing, { scope.launch { refreshing = true; host.loadRecentAgents(); refreshing = false } }) {
        LazyColumn(Modifier.fillMaxSize()) {
          item { Text(agentsSummary(agents), Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = theme.textSecondary, style = ArgusTheme.typography.footnote) }
          items(agents, key = { it.agentId }) { agent ->
            HomeRow(Labels.agentName(agent), onClick = { router.push(Route.Agent(agent.agentId, Labels.agentName(agent))) }) {
              Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { AgentStatusRow(host, agent) }
                Icon(Icon.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
              }
            }
            HorizontalDivider(Modifier.padding(start = 34.dp), color = theme.borderSubtle)
          }
        }
      }
    }
  }
}
