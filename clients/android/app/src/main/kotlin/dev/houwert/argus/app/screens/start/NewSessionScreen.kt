package dev.houwert.argus.app.screens.start

import dev.houwert.argus.core.sessions.AgentStartDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.sessions.StartWorkspace
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.TopBarScreen
import kotlinx.coroutines.launch

/** Where a start lands: the agent, a compare run's overview, or the new session. */
fun Route.Companion.of(started: StartedAgent): Route = when (started) {
  is StartedAgent.Agent -> Route.Agent(started.agent.agentId, Labels.agentName(started.agent))
  is StartedAgent.Session -> started.session.compareGroup?.let { Route.CompareRun(it.id) }
    ?: Route.Session(started.session.id, SessionActivity.title(started.session), started.session.repoRoot)
}

/** The project the last active agent worked in, else the first. */
fun lastActiveProject(host: HostStore): String? {
  val roots = host.projects.value.map { it.repoRoot }.toSet()
  val recent = host.recentAgents.value.maxByOrNull { it.lastActivityAt ?: 0.0 }?.let { host.session(it.sessionId)?.repoRoot }
  return recent?.takeIf { it in roots } ?: host.projects.value.firstOrNull()?.repoRoot
}

/**
 * The Mac's New Session as a pushed screen: the start composer on a new worktree. Opened on a
 * project it starts there; from Home the heading picks the project.
 */
@Composable
fun NewSessionScreen(repoRoot: String?) {
  val app = LocalAppStore.current
  val defaultMode by app.prefs.defaultPermissionMode.collectAsState()
  val router = LocalRouter.current
  val host = app.host
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  val projects by host.projects.collectAsState()
  val scope = rememberCoroutineScope()
  val recent by host.recentAgents.collectAsState()
  val project = repoRoot ?: remember(projects, recent) { lastActiveProject(host) }
  // Branches are addressed by session; the project root answers for the project.
  val rootSessionId = if (repoRoot != null) sessionsByRepo[repoRoot]?.firstOrNull { it.kind == RemoteSessionKind.projectRoot }?.id else null

  LaunchedEffect(project) { if (project != null && sessionsByRepo[project] == null) host.loadSessions(project) }

  TopBarScreen("New Session", onBack = router::pop) {
    // A late root session or project changes what the composer was built on.
    key(project, rootSessionId) {
      AgentStartPane(host, project, rootSessionId, workspace = StartWorkspace.Kind.Worktree,
        defaults = AgentStartDefaults(mode = defaultMode?.rawValue),
        picksProject = repoRoot == null, takesShare = true, preferences = app.preferences,
      ) { started ->
        // Back from the new session skips this composer, as closing the Mac's sheet does.
        router.replaceTop(Route.of(started), 1)
        if (started is StartedAgent.Session) scope.launch { host.loadSessions(started.session.repoRoot) }
      }
    }
  }
}
