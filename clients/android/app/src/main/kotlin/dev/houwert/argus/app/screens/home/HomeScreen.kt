package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.AppSection
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.telemetry.TelemetryEvent.HomeAction
import dev.houwert.argus.core.sessions.isArchived
import dev.houwert.argus.core.sessions.archivedSessions
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.createScratchPad
import dev.houwert.argus.core.stores.deleteScratchPad
import dev.houwert.argus.core.stores.loadRecentAgents
import dev.houwert.argus.core.stores.loadScratchPads
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.grouping
import dev.houwert.argus.core.stores.groupingFlow
import dev.houwert.argus.core.stores.refreshProjects
import dev.houwert.argus.core.stores.removeProject
import dev.houwert.argus.core.stores.scratchPadAgent
import dev.houwert.argus.core.usage.loadUsageLimits
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.sessions.AgentStatusRow
import dev.houwert.argus.ui.sessions.SessionTriageSheet
import dev.houwert.argus.ui.sessions.SessionTriageSheetDialog
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.launch

/**
 * `/`: Home, as on the Mac. Which computer this is, what needs you, each project's activity, the
 * agents worth jumping back into, and the latest automation runs.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val loaded by app.loaded.collectAsState()
  val hosts by app.pairedHosts.collectAsState()
  val identity by app.identity.collectAsState()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val projects by host.projects.collectAsState()
  val projectsLoaded by host.projectsLoaded.collectAsState()
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  val grouping by host.groupingFlow.collectAsState(host.grouping)
  val recent by host.recentAgents.collectAsState()
  val scratchPads by host.scratchPads.collectAsState()
  val gitStatus by host.gitStatusBySession.collectAsState()
  val collapsed by ProjectFolds.collapsed.collectAsState()
  val unfolded by ProjectFolds.unfolded.collectAsState()
  val runs by app.automations.runs.collectAsState()
  val proposals by app.proposals.proposals.collectAsState()
  val usageLimits by host.usageLimits.collectAsState()
  val hasControl = "control" in capabilities
  val scope = rememberCoroutineScope()
  var refreshing by remember { mutableStateOf(false) }
  var padToDelete by remember { mutableStateOf<RemoteSession?>(null) }
  var projectToRemove by remember { mutableStateOf<RemoteProject?>(null) }
  var triageSheet by remember { mutableStateOf<SessionTriageSheet?>(null) }
  var openingPad by remember { mutableStateOf(false) }
  val hostName = identity?.label ?: "Argus"
  val ready = connection == Transport.State.Ready

  suspend fun refresh() {
    host.refreshProjects()
    host.loadRecentAgents()
    host.loadScratchPads()
    app.automations.refresh()
    app.proposals.refresh()
  }

  LiveRefresh(identity != null && ready, 30.seconds) { refresh() }
  // usage_limits.changed keeps the strip fresh between polls.
  LiveRefresh(identity != null && ready, 1.minutes) { host.loadUsageLimits() }
  // Each card lists its project's sessions; agents come from the cross-project list.
  LaunchedEffect(projects.map { it.repoRoot }, ready) {
    if (!ready) return@LaunchedEffect
    for (project in projects) if (sessionsByRepo[project.repoRoot] == null) host.loadSessions(project.repoRoot)
  }

  fun newSession(project: RemoteProject?) = router.push(Route.NewSession(project?.repoRoot))
  fun openAgent(fetch: suspend () -> RemoteAgentStatus?) {
    openingPad = true
    scope.launch {
      val agent = fetch()
      openingPad = false
      if (agent != null) router.push(Route.Agent(agent.agentId, Labels.agentName(agent)))
    }
  }

  TopBarScreen(
    "Home",
    actions = {
      if (hasControl && identity != null) IconBtn(Icon.blueprint, "New project") { router.push(Route.NewProject()) }
      // The Mac sidebar's New Session, on the project last worked in.
      if (hasControl && projects.isNotEmpty()) IconBtn(Icon.compose, "New session") { newSession(null) }
    },
  ) {
    if (loaded && hosts.isEmpty()) {
      EmptyState(Icon.desktop, "No computers paired", body = "Pair with Argus on your Mac to drive its agents from here.") {
        Btn("Pair a computer", icon = Icon.plus, hugs = true) { router.push(Route.Pair) }
      }
      return@TopBarScreen
    }
    PullToRefreshBox(refreshing, { scope.launch { refreshing = true; refresh(); refreshing = false } }, Modifier.fillMaxSize()) {
      LazyColumn(Modifier.fillMaxSize().widthIn(max = 960.dp)) {
        item("switcher") { ComputerSwitcher() }
        if (!loaded || ((!ready || !projectsLoaded) && projects.isEmpty())) {
          item("loading") { Loading("Connecting to $hostName") }
          return@LazyColumn
        }
        planLimitsSection(usageLimits) { router.push(Route.Usage) }
        needsYouSection(
          app.proposals.items(runs, emptySet()).needsYou(), { followHomeLink(HomeAction.Inbox) { router.show(AppSection.Inbox) } }, router::push,
        )
        // Projects
        if (projects.isEmpty()) {
          if (projectsLoaded && recent.isEmpty()) {
            item("projects-header") { HomeSectionHeader("Projects") }
            item("projects-empty") {
              MutedText(
                "Open a repository in Argus on $hostName and it'll show up here, or start a new one from a blueprint.",
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
              )
            }
          }
        } else {
          item("projects-header") { HomeSectionHeader("Projects") }
          val all = sessionsByRepo.values.flatten()
          val push = { route: Route ->
            when (route) {
              is Route.Session -> followHomeLink(HomeAction.Session) { router.push(route) }
              is Route.Project -> followHomeLink(HomeAction.Project) { router.push(route) }
              else -> router.push(route)
            }
          }
          val actions = HomeProjectActions(push, ::newSession, { triageSheet = it }, { projectToRemove = it })
          for (project in projects) {
            homeProjectSection(
              host, project, sessionsByRepo[project.repoRoot].orEmpty(), grouping.sessionGroups(project.repoRoot), all, gitStatus,
              collapsed, unfolded, hasControl, actions,
            )
          }
        }
        recentAgentsSection(host, grouping.recentAgentsByActivity, router::push) { followHomeLink(HomeAction.Agents) { router.show(AppSection.Agents) } }
        recentRunsSection(runs, { followHomeLink(HomeAction.Automations) { router.show(AppSection.Automations) } }, router::push)
        // One-off agents that belong to no project; opening one lands in its chat.
        if (scratchPads.isNotEmpty() || hasControl) {
          item("pads-header") { HomeSectionHeader("Scratch pads") }
          items(scratchPads.filter { !it.isArchived }, key = { "pad:${it.id}" }) { pad ->
            PressableRow(
              pad.displayName ?: "Scratch pad", Modifier.padding(horizontal = 16.dp, vertical = 12.dp), enabled = !openingPad,
              onClick = { openAgent { host.scratchPadAgent(pad) } },
              menu = if (hasControl) ({ dismiss ->
                androidx.compose.material3.DropdownMenuItem(
                  { Text("Delete", color = ArgusTheme.colors.error) }, { dismiss(); padToDelete = pad },
                  leadingIcon = { Icon(Icon.trash, null, tint = ArgusTheme.colors.error) },
                )
              }) else null,
            ) { IconLabel(Icon.scratchPad, pad.displayName ?: "Scratch pad") }
          }
          if (hasControl) item("pad-new") {
            PressableRow("New scratch pad", Modifier.padding(horizontal = 16.dp, vertical = 12.dp), enabled = !openingPad, onClick = { openAgent { host.createScratchPad() } }) {
              IconLabel(Icon.plus, "New scratch pad", accent = true)
            }
          }
        }
        val archivedCount = archivedSessions(sessionsByRepo.values.flatten() + scratchPads).size
        if (archivedCount > 0) item("archived") {
          PressableRow("Show archived sessions", Modifier.padding(horizontal = 16.dp, vertical = 12.dp), onClick = { router.push(Route.ArchivedSessions) }) {
            IconLabel(Icon.archive, "$archivedCount archived")
          }
        }
        item("bottom") { Box(Modifier.size(24.dp)) }
      }
    }
  }

  padToDelete?.let { pad ->
    AlertDialog(
      { padToDelete = null },
      title = { Text("Delete ${pad.displayName ?: "scratch pad"}?") },
      text = { Text("Its agents are stopped and every file in its folder is removed.") },
      confirmButton = { TextButton({ padToDelete = null; scope.launch { host.deleteScratchPad(pad.id) } }) { Text("Delete", color = ArgusTheme.colors.error) } },
      dismissButton = { TextButton({ padToDelete = null }) { Text("Cancel") } },
    )
  }
  projectToRemove?.let { project ->
    AlertDialog(
      { projectToRemove = null },
      title = { Text("Remove ${project.name}?") },
      text = { Text("Its agents and terminals stop. The repository and its worktrees stay on $hostName.") },
      confirmButton = { TextButton({ projectToRemove = null; scope.launch { host.removeProject(project.repoRoot) } }) { Text("Remove", color = ArgusTheme.colors.error) } },
      dismissButton = { TextButton({ projectToRemove = null }) { Text("Cancel") } },
    )
  }
  triageSheet?.let { SessionTriageSheetDialog(host, it) { triageSheet = null } }
}

@Composable
private fun IconLabel(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, accent: Boolean = false) {
  val theme = ArgusTheme.colors
  Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, Modifier.size(18.dp), tint = theme.accent)
    Text(label, color = if (accent) theme.accent else theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

private const val RECENT_AGENT_LIMIT = 5

/** Agents across every project: still working or waiting on you before the merely recent. The full list is the Agents tab. */
private fun androidx.compose.foundation.lazy.LazyListScope.recentAgentsSection(
  host: HostStore,
  byActivity: List<RemoteAgentStatus>,
  push: (Route) -> Unit,
  seeAll: () -> Unit,
) {
  val agents = byActivity.take(RECENT_AGENT_LIMIT)
  if (agents.isEmpty()) return
  item("agents-header") { HomeSectionHeader("Recent agents", action = "See all" to seeAll) }
  items(agents, key = { "agent:${it.agentId}" }) { agent ->
    HomeRow(Labels.agentName(agent), onClick = { push(Route.Agent(agent.agentId, Labels.agentName(agent))) }) {
      AgentStatusRow(host, agent)
    }
  }
}
