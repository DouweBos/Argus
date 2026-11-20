package dev.houwert.argus.app.screens.project

import dev.houwert.argus.core.sessions.AgentStartDefaults
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.home.HomeRow
import dev.houwert.argus.app.screens.home.HomeSectionHeader
import dev.houwert.argus.app.screens.home.PressableRow
import dev.houwert.argus.app.screens.home.ProjectFolds
import dev.houwert.argus.app.screens.home.SessionListRowView
import dev.houwert.argus.app.screens.start.AgentStartPane
import dev.houwert.argus.app.screens.start.of
import dev.houwert.argus.core.sessions.SessionGroup
import dev.houwert.argus.core.sessions.SessionGroupTriage
import dev.houwert.argus.core.sessions.SessionListRow
import dev.houwert.argus.core.sessions.StartWorkspace
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.deleteChatHistory
import dev.houwert.argus.core.stores.grouping
import dev.houwert.argus.core.stores.groupingFlow
import dev.houwert.argus.core.stores.loadAgents
import dev.houwert.argus.core.stores.loadGitStatus
import dev.houwert.argus.core.stores.loadRecentAgents
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.loadStoppedAgents
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.isUnavailable
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.OnResume
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.sessions.ChatSearchSheet
import dev.houwert.argus.ui.sessions.FoldedSessionsLabel
import dev.houwert.argus.ui.sessions.SnoozeUntilDialog
import dev.houwert.argus.ui.sessions.StoppedAgentRow
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/**
 * One repository's sessions, one row each, the project root first: the way the Mac sidebar lists
 * them. A session's agents and tools live on its own screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectScreen(repoRoot: String, name: String) {
  val app = LocalAppStore.current
  val defaultMode by app.prefs.defaultPermissionMode.collectAsState()
  val router = LocalRouter.current
  val host = app.host
  val theme = ArgusTheme.colors
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  val grouping by host.groupingFlow.collectAsState(host.grouping)
  val gitStatus by host.gitStatusBySession.collectAsState()
  val stoppedByRepo by host.stoppedByRepo.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val connection by host.connection.collectAsState()
  val unfoldedSet by ProjectFolds.unfolded.collectAsState()
  val hasControl = "control" in capabilities
  val scope = rememberCoroutineScope()
  var refreshing by remember { mutableStateOf(false) }
  var snoozing by remember { mutableStateOf<RemoteSession?>(null) }
  var stackingOn by remember { mutableStateOf<RemoteSession?>(null) }
  var searchingChats by remember { mutableStateOf(false) }
  var showingStopped by remember { mutableStateOf(false) }
  val sessions = sessionsByRepo[repoRoot].orEmpty()
  val groups = grouping.sessionGroups(repoRoot)
  val showingFolded = repoRoot in unfoldedSet
  val live = sessions.map { it.branch }.toSet()
  // Stopped agents whose session is gone; every other one is under its session's details.
  val orphaned = stoppedByRepo[repoRoot].orEmpty().filter { it.branch !in live }

  suspend fun refresh() {
    host.loadAgents(repoRoot)
    host.loadSessions(repoRoot)
    host.loadRecentAgents()
    host.loadStoppedAgents(repoRoot)
  }
  suspend fun refreshGit() {
    for (group in groups) if (group.session?.isUnavailable != true) host.loadGitStatus(group.id)
  }
  LiveRefresh(connection == Transport.State.Ready) { refresh() }
  // Git state is fetched per session rather than polled, so it goes stale while the phone is locked.
  OnResume(connection == Transport.State.Ready) { refreshGit() }
  LaunchedEffect(groups.map { it.id }) { refreshGit() }

  TopBarScreen(
    name, onBack = router::pop,
    actions = {
      if (stoppedByRepo[repoRoot].orEmpty().isNotEmpty()) IconBtn(Icon.history, "Search saved chats") { searchingChats = true }
      if (hasControl) IconBtn(Icon.plus, "New session") { router.push(Route.NewSession(repoRoot)) }
    },
  ) {
    when {
      // Agents can name a session before the project's sessions arrive, so only an answered list means "none".
      groups.isEmpty() && sessionsByRepo[repoRoot] == null -> Loading("Reading sessions")
      groups.isEmpty() && hasControl -> AgentStartPane(
        host, repoRoot, (sessions.firstOrNull { it.kind == RemoteSessionKind.projectRoot } ?: sessions.firstOrNull())?.id,
        workspace = StartWorkspace.Kind.Worktree,
        defaults = AgentStartDefaults(mode = defaultMode?.rawValue),
        preferences = app.preferences,
      ) { started ->
        router.push(Route.of(started))
        scope.launch { refresh() }
      }
      groups.isEmpty() -> EmptyState(Icon.agent, "No sessions", body = "Start an agent in this project from Argus on your computer and it'll appear here.")
      else -> PullToRefreshBox(refreshing, { scope.launch { refreshing = true; refresh(); refreshGit(); refreshing = false } }) {
        val triage = SessionGroupTriage(groups)
        LazyColumn(Modifier.fillMaxSize()) {
          if (triage.needsYou.isNotEmpty()) {
            item("needs") { HomeSectionHeader("Needs you") }
            sessionRows("n", host, triage.needsYou, sessions, gitStatus, hasControl, repoRoot, router::push, { snoozing = it }, { stackingOn = it })
            item("active") { HomeSectionHeader("Sessions") }
          }
          sessionRows("a", host, triage.active, sessions, gitStatus, hasControl, repoRoot, router::push, { snoozing = it }, { stackingOn = it })
          if (triage.folded.isNotEmpty()) {
            item("fold") {
              HomeRow(triage.foldedLabel, onClick = { ProjectFolds.toggle(ProjectFolds.unfolded, repoRoot) }) {
                FoldedSessionsLabel(triage.foldedLabel, showingFolded)
              }
            }
            if (showingFolded) sessionRows("f", host, triage.folded, sessions, gitStatus, hasControl, repoRoot, router::push, { snoozing = it }, { stackingOn = it })
          }
          if (orphaned.isNotEmpty()) {
            item("stopped") {
              HomeRow("Recently stopped", onClick = { showingStopped = !showingStopped }) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                  Icon(Icon.history, null, Modifier.size(16.dp), tint = theme.textSecondary)
                  FoldedSessionsLabel("${orphaned.size} recently stopped from deleted sessions", showingStopped)
                }
              }
            }
            if (showingStopped) items(orphaned, key = { "stopped:${it.historyId}" }) { agent ->
              PressableRow(
                agent.title, Modifier.padding(horizontal = 16.dp, vertical = 10.dp), onClick = { router.push(stoppedRoute(repoRoot, agent)) },
                menu = if (hasControl) ({ dismiss ->
                  DropdownMenuItem(
                    { Text("Delete", color = theme.error) },
                    { dismiss(); scope.launch { host.deleteChatHistory(repoRoot, listOf(agent.historyId)) } },
                    leadingIcon = { Icon(Icon.trash, null, tint = theme.error) },
                  )
                }) else null,
              ) { StoppedAgentRow(agent, showBranch = true) }
            }
          }
        }
      }
    }
  }

  snoozing?.let { SnoozeUntilDialog(host, it) { snoozing = null } }
  stackingOn?.let { parent ->
    StackedSessionSheet(host, parent, { router.push(Route.Session(it.id, it.displayName ?: it.branch, repoRoot)) }) { stackingOn = null }
  }
  if (searchingChats) {
    ChatSearchSheet(host, repoRoot, { router.push(stoppedRoute(repoRoot, it)) }, {}) { searchingChats = false }
  }
}

private fun stoppedRoute(repoRoot: String, agent: RemoteStoppedAgent) =
  Route.StoppedAgent(agent.historyId, repoRoot, agent.title, agent.branch, agent.runnerSessionId)

/** Session rows, a compare run's slots under its header, a stacked session under its parent. */
private fun LazyListScope.sessionRows(
  prefix: String,
  host: HostStore,
  groups: List<SessionGroup>,
  all: List<RemoteSession>,
  git: Map<String, dev.houwert.argus.kit.protocol.generated.RemoteGitStatus>,
  hasControl: Boolean,
  repoRoot: String,
  push: (Route) -> Unit,
  snooze: (RemoteSession) -> Unit,
  stack: (RemoteSession) -> Unit,
) {
  items(SessionListRow.make(groups, all), key = { "$prefix:${it.key}" }) { row ->
    SessionListRowView(
      host, row,
      open = { push(Route.Session(it.group.id, it.group.label, repoRoot)) },
      openCompare = { push(Route.CompareRun(it)) },
      snooze = snooze,
      git = (row as? SessionListRow.Session)?.group?.id?.let { git[it] },
      detailed = true,
      extraMenu = { session, dismiss ->
        if (hasControl && session.kind == RemoteSessionKind.worktree && session.status == RemoteSessionStatus.ready && session.compareGroup == null) {
          DropdownMenuItem({ Text("New session on top") }, { dismiss(); stack(session) }, leadingIcon = { Icon(Icon.stacked, null) })
        }
      },
    )
  }
}

