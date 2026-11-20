package dev.houwert.argus.app.screens.issues

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.LinearIssueBoard
import dev.houwert.argus.core.stores.LinearIssueDetailModel
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.startFromIssues
import dev.houwert.argus.core.stores.summary
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.storage.PreferenceKey
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.PickerSheet
import dev.houwert.argus.ui.integrations.LinearIssueDetailView
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch
import dev.houwert.argus.ui.components.TitleBar
import dev.houwert.argus.app.screens.backAction

/**
 * One Linear issue as Linear shows it: properties, description, sub-issues, relations, resources
 * and the activity timeline. With control, change its status and priority, comment, reply in a
 * thread, or start an agent on it in a project of the computer.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssueScreen(ref: String) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val host = app.host
  val model = remember(ref, host) { LinearIssueDetailModel(ref, host) }
  val scope = rememberCoroutineScope()
  val issue by model.issue.collectAsState()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val projects by host.projects.collectAsState()
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  var refreshing by remember { mutableStateOf(false) }
  var starting by remember { mutableStateOf<LinearIssue?>(null) }
  val control = "control" in capabilities

  // "Open session" needs every project's sessions, not just the ones opened.
  LaunchedEffect(connection, projects) {
    if (connection == Transport.State.Ready) projects.forEach { host.loadSessions(it.repoRoot) }
  }

  val sessionOnIt = issue?.let { LinearIssueBoard.session(it.summary(), sessionsByRepo.values.flatten()) }

  /** Straight to its agent when one is live, otherwise the project it is in. */
  fun open(session: RemoteSession) {
    val agent = host.recentAgents.value.firstOrNull { it.sessionId == session.id }
    if (agent != null) return router.push(Route.Agent(agent.agentId, Labels.agentName(agent)))
    val name = projects.firstOrNull { it.repoRoot == session.repoRoot }?.name ?: session.branch
    router.push(Route.Project(session.repoRoot, name))
  }

  Column(Modifier.fillMaxSize().background(ArgusTheme.colors.bg)) {
    TitleBar(issue?.identifier ?: ref, onBack = backAction())
    PullToRefreshBox(
      refreshing,
      {
        scope.launch {
          refreshing = true
          model.load()
          refreshing = false
        }
      },
      Modifier.fillMaxWidth().weight(1f),
    ) {
      LinearIssueDetailView(
        model, canEdit = control, canStart = control && projects.isNotEmpty(), sessionOnIt = sessionOnIt,
        onOpenSession = ::open, onStart = { starting = it },
        onOpenIssue = { router.push(Route.Issue(it)) },
        onOpenDesign = { router.push(Route.Design(it, null)) },
      )
    }
  }

  starting?.let { picked ->
    // The only project, or the one the last issue went to while it's still open, as the Mac does.
    val preselected = projects.singleOrNull()?.repoRoot
      ?: app.preferences.string(PreferenceKey.ISSUE_START_PROJECT)?.takeIf { last -> projects.any { it.repoRoot == last } }
    PickerSheet(
      "Start agent on ${picked.identifier}",
      projects.map { PickerOption(it.repoRoot, it.name, hint = "A worktree on ${picked.branchName}") },
      selected = setOfNotNull(preselected),
      onPick = { repoRoot ->
        scope.launch {
          val started = host.startFromIssues(listOf(picked), repoRoot)
          if (started.isNotEmpty()) {
            app.preferences.set(repoRoot, PreferenceKey.ISSUE_START_PROJECT)
            host.loadSessions(repoRoot)
          }
        }
      },
      onDismiss = { starting = null },
      emptyMessage = "Add a project on the computer to start agents on issues.",
    )
  }
}
