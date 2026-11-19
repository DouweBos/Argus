package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.stores.BackgroundRefresh
import dev.houwert.argus.core.stores.LoadPhase
import dev.houwert.argus.core.stores.loadRecentAgents
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.refreshProjects
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import kotlinx.coroutines.delay

/**
 * Minimal Home for wave 1: the connected computer's projects with their
 * sessions, so the connection is visibly working. Wave 2 builds the real one.
 */
@Composable
fun HomeScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val loaded by app.loaded.collectAsState()
  val identity by app.identity.collectAsState()
  val connection by app.host.connection.collectAsState()
  val projects by app.host.projects.collectAsState()
  val projectsLoaded by app.host.projectsLoaded.collectAsState()
  val sessionsByRepo by app.host.sessionsByRepo.collectAsState()

  // Projects arrive as events with a slow poll behind them.
  LaunchedEffect(connection) {
    if (connection != Transport.State.Ready) return@LaunchedEffect
    while (true) {
      BackgroundRefresh.run {
        app.host.refreshProjects()
        app.host.loadRecentAgents()
        app.host.projects.value.forEach { app.host.loadSessions(it.repoRoot) }
      }
      delay(30_000)
    }
  }

  if (!loaded) return
  if (identity == null) return Unpaired { router.push(Route.Pair) }

  LazyColumn(Modifier.fillMaxSize()) {
    item {
      ListItem(
        headlineContent = { Text(identity?.label ?: "", style = MaterialTheme.typography.titleLarge) },
        supportingContent = { Text(connectionLabel(connection)) },
      )
    }
    when (val phase = LoadPhase.of(projectsLoaded, null, projects.isEmpty())) {
      LoadPhase.Loading -> item { Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator() } }
      LoadPhase.Empty -> item { ListItem(headlineContent = { Text("No projects on this computer yet") }) }
      is LoadPhase.Failed -> item { ListItem(headlineContent = { Text(phase.message) }) }
      LoadPhase.Content -> projects.forEach { project ->
        item(key = "p:${project.repoRoot}") { ProjectHeader(project) { router.push(Route.Project(project.repoRoot, project.name)) } }
        items(sessionsByRepo[project.repoRoot].orEmpty(), key = { "s:${it.id}" }) { session ->
          SessionRow(session) { router.push(Route.Session(session.id, SessionActivity.title(session), session.repoRoot)) }
        }
        item(key = "d:${project.repoRoot}") { HorizontalDivider() }
      }
    }
  }
}

@Composable
private fun Unpaired(onPair: () -> Unit) {
  Column(
    Modifier.fillMaxSize().padding(32.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text("Pair with your computer", style = MaterialTheme.typography.titleLarge)
    Text("Open Argus on your computer, then scan its pairing code or paste it here.", style = MaterialTheme.typography.bodyMedium)
    Button(onClick = onPair) { Text("Pair a computer") }
  }
}

@Composable
private fun ProjectHeader(project: RemoteProject, onOpen: () -> Unit) {
  ListItem(
    headlineContent = { Text(project.name, style = MaterialTheme.typography.titleMedium) },
    modifier = Modifier.clickable(onClickLabel = "Open project", onClick = onOpen),
  )
}

@Composable
private fun SessionRow(session: RemoteSession, onOpen: () -> Unit) {
  ListItem(
    headlineContent = { Text(SessionActivity.title(session)) },
    supportingContent = { Text(session.branch) },
    modifier = Modifier.padding(start = 16.dp).clickable(onClickLabel = "Open session", onClick = onOpen),
  )
}

private fun connectionLabel(state: Transport.State) = when (state) {
  Transport.State.Ready -> "Connected"
  Transport.State.Connecting, Transport.State.Handshaking -> "Connecting"
  Transport.State.Offline -> "Offline"
}
