package dev.houwert.argus.app.screens.session

import androidx.compose.runtime.collectAsState
import dev.houwert.argus.core.sessions.AgentStartDefaults
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.DropdownMenu
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.start.AgentStartPane
import dev.houwert.argus.app.screens.start.StartedAgent
import dev.houwert.argus.app.screens.start.of
import dev.houwert.argus.core.sessions.StartWorkspace
import dev.houwert.argus.kit.protocol.isOutsideProjects
import dev.houwert.argus.core.stores.MovedChat
import dev.houwert.argus.core.stores.continueRunners
import dev.houwert.argus.core.stores.deleteSession
import dev.houwert.argus.core.stores.markSessionReady
import dev.houwert.argus.core.stores.retrySessionSetup
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.card
import dev.houwert.argus.ui.composer.ContinueOnMenuItems
import dev.houwert.argus.ui.composer.MoveToSheet
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.session.SessionDeletingView
import dev.houwert.argus.ui.session.SetupFailedActions
import dev.houwert.argus.ui.session.SetupFailedRow
import dev.houwert.argus.ui.session.SetupPendingRow
import dev.houwert.argus.ui.session.SetupProgressCard
import dev.houwert.argus.ui.session.rememberSetupStep

// The session screen's pieces that come from the shared views, wired to the store.

private fun failedActions(host: dev.houwert.argus.core.stores.HostStore, s: RemoteSession) = SetupFailedActions(
  retrySetup = { host.retrySessionSetup(s.id, s.repoRoot) },
  markReady = { host.markSessionReady(s.id, s.repoRoot) },
  retryDelete = { host.deleteSession(s.id, s.repoRoot, deleteBranch = null) },
  deleteAnyway = { host.deleteSession(s.id, s.repoRoot, deleteBranch = null, skipTeardown = true) },
)

/** Setup still to run, or a failure under an agent that can still be shown. */
@Composable
internal fun SetupBanner(session: RemoteSession, modifier: Modifier = Modifier) {
  val host = LocalAppStore.current.host
  Column(modifier.fillMaxWidth().card()) {
    if (session.status == RemoteSessionStatus.error) SetupFailedRow(session, host.hasControl, failedActions(host, session))
    else SetupPendingRow(
      host.hasControl,
      runSetup = { host.retrySessionSetup(session.id, session.repoRoot) },
      skip = { host.markSessionReady(session.id, session.repoRoot) },
    )
  }
}

@Composable
internal fun SetupProgress(session: RemoteSession) {
  val host = LocalAppStore.current.host
  SetupProgressCard(session, rememberSetupStep(host, session.id))
}

@Composable
internal fun SetupFailed(session: RemoteSession) {
  val host = LocalAppStore.current.host
  Column(Modifier.fillMaxWidth().card()) { SetupFailedRow(session, host.hasControl, failedActions(host, session)) }
}

@Composable
internal fun SessionDeleting(session: RemoteSession) = SessionDeletingView(session.progress)

/** "What should we build in <project>?" over the composer, starting in this session's checkout. */
@Composable
internal fun StartPane(session: RemoteSession, started: (RemoteAgentStatus) -> Unit) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val mode by app.prefs.defaultPermissionMode.collectAsState()
  androidx.compose.runtime.key("start:${session.id}") {
    AgentStartPane(
      app.host,
      repoRoot = if (session.isOutsideProjects) null else session.repoRoot,
      sessionId = session.id,
      workspace = StartWorkspace.Kind.Current,
      defaults = AgentStartDefaults(mode = mode?.rawValue),
      preferences = app.preferences,
    ) { outcome ->
      // A new worktree is another session; open it rather than a tab here.
      if (outcome is StartedAgent.Agent && outcome.agent.sessionId == session.id) started(outcome.agent)
      else router.push(Route.of(outcome))
    }
  }
}

@Composable
internal fun SidePanel(session: RemoteSession, agentId: String?, modifier: Modifier, open: (Route) -> Unit) =
  SessionSidePanel(session, agentId, modifier, open)

@Composable
internal fun DetailsSheet(
  session: RemoteSession,
  agentId: String?,
  open: (Route) -> Unit,
  newAgent: () -> Unit,
  deleted: () -> Unit,
  onDismiss: () -> Unit,
) = SessionDetailsSheet(session, agentId, open, newAgent, deleted, onDismiss)

/** "Continue on" another runner, as rows in the tab menu; a dropdown lists the runners. */
@Composable
internal fun ContinueOnAgentItems(agentId: String, onContinued: (RemoteAgentStatus) -> Unit, onError: (String) -> Unit) {
  val host = LocalAppStore.current.host
  if (!host.hasControl || host.continueRunners(agentId).isEmpty()) return
  var expanded by remember { mutableStateOf(false) }
  ListRow("Continue on", icon = Icon.agent, onClick = { expanded = true })
  DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
    ContinueOnMenuItems(host, agentId, onContinued = onContinued, onError = onError, onDismiss = { expanded = false })
  }
}

@Composable
internal fun MoveToAgentSheet(agentId: String, onMoved: (MovedChat) -> Unit, onError: (String) -> Unit, onDismiss: () -> Unit) {
  val host = LocalAppStore.current.host
  MoveToSheet(host, agentId, onMoved = onMoved, onError = onError, onDismiss = onDismiss)
}
