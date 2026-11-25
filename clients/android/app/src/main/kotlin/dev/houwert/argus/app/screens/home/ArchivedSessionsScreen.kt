package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import dev.houwert.argus.app.screens.inbox.TopBarScaffold
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.sessions.archivedSessions
import dev.houwert.argus.core.stores.agents
import dev.houwert.argus.core.stores.setSessionArchived
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.isUnavailable
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ChromeText
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.sessions.SessionRow
import dev.houwert.argus.ui.sessions.SessionRowMenuItems
import dev.houwert.argus.ui.sessions.SessionTriageSheet
import dev.houwert.argus.ui.sessions.SessionTriageSheetDialog
import kotlinx.coroutines.launch

/** `/sessions/archived`: every archived session by project, newest archived first, each with Restore. */
@Composable
fun ArchivedSessionsScreen() {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val scope = rememberCoroutineScope()
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  val scratchPads by host.scratchPads.collectAsState()
  val projects by host.projects.collectAsState()
  host.capabilities.collectAsState().value
  var triageSheet by remember { mutableStateOf<SessionTriageSheet?>(null) }
  val archived = archivedSessions(sessionsByRepo.values.flatten() + scratchPads)
  val groups = projects.mapNotNull { project ->
    archived.filter { it.repoRoot == project.repoRoot && !it.isOutsideProjects }.takeIf { it.isNotEmpty() }?.let { project.name to it }
  } + listOfNotNull(archived.filter { it.isOutsideProjects }.takeIf { it.isNotEmpty() }?.let { "Scratch pads" to it })

  TopBarScaffold("Archived") {
    if (archived.isEmpty()) {
      EmptyState(
        Icon.archive, "Nothing archived",
        body = "Archive a session from its menu to hide it from the list. It comes back here, worktree and all.",
      )
    } else {
      LazyColumn(Modifier.fillMaxSize()) {
        for ((title, sessions) in groups) {
          item("h:$title") { SectionHeader(title, Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp)) }
          items(sessions, key = { it.id }) { session ->
            Row(Modifier.padding(end = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              Box(Modifier.weight(1f)) {
                PressableRow(
                  "Open ${SessionActivity.title(session)}", Modifier.padding(start = 16.dp, top = 8.dp, bottom = 8.dp),
                  enabled = !session.isUnavailable,
                  onClick = { router.push(Route.Session(session.id, SessionActivity.title(session), session.repoRoot)) },
                  menu = { dismiss -> SessionRowMenuItems(host, session, dismiss) { triageSheet = it } },
                ) {
                  SessionRow(session, host.agents(session), detailed = true, caption = archivedCaption(session))
                }
              }
              if (host.hasControl) {
                Btn("Restore", tone = ButtonTone.Secondary, small = true, hugs = true) {
                  scope.launch { host.setSessionArchived(session, false) }
                }
              }
            }
          }
        }
      }
    }
  }
  triageSheet?.let { SessionTriageSheetDialog(host, it) { triageSheet = null } }
}

private val RemoteSession.isOutsideProjects: Boolean
  get() = kind.rawValue == "scratch_pad" || kind.rawValue == "automation_host"

private fun archivedCaption(session: RemoteSession): String? =
  session.archivedAt?.let { "Archived ${ChromeText.shortAge(it)} ago" }
