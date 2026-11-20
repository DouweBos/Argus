package dev.houwert.argus.ui.composer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.sessions.SessionActivity
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.MovedChat
import dev.houwert.argus.core.stores.canContinueElsewhere
import dev.houwert.argus.core.stores.moveDestinations
import dev.houwert.argus.core.stores.transferAgent
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/**
 * "Move to" as a bottom sheet: each project, then a new session or one of its sessions. The chat
 * goes on there and this agent stops.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MoveToSheet(
  host: HostStore,
  agentId: String,
  onMoved: (MovedChat) -> Unit,
  onError: (String) -> Unit,
  onDismiss: () -> Unit,
) {
  val theme = ArgusTheme.colors
  host.projects.collectAsState().value
  host.sessionsByRepo.collectAsState().value
  host.statusByAgent.collectAsState().value
  val destinations = host.moveDestinations(agentId)
  val enabled = host.hasControl && host.canContinueElsewhere(agentId)
  val scope = rememberCoroutineScope()
  fun move(sessionId: String? = null, repoRoot: String? = null) {
    onDismiss()
    scope.launch {
      try {
        onMoved(host.transferAgent(agentId, sessionId, repoRoot))
      } catch (error: Exception) {
        onError(HostStore.describe(error))
      }
    }
  }
  ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(), containerColor = theme.bg, contentColor = theme.text) {
    Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(44.dp), contentAlignment = Alignment.Center) {
      Text("Move to", color = theme.text, style = ArgusTheme.typography.headline)
      AccentLink("Done", Modifier.align(Alignment.CenterEnd), size = 17, onClick = onDismiss)
    }
    if (destinations.isEmpty()) {
      Box(Modifier.fillMaxWidth().padding(bottom = 32.dp).navigationBarsPadding()) {
        EmptyState(Icon.moveChat, "Nowhere to move", body = "Add a project on the computer first.")
      }
      return@ModalBottomSheet
    }
    LazyColumn(
      Modifier.padding(horizontal = 16.dp).navigationBarsPadding(),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      if (!enabled) item { MutedText("Moves wait for the agent's turn to end.") }
      items(destinations, key = { it.id }) { destination ->
        ListSection(header = destination.project.name) {
          ListRow("New session", icon = Icon.plus, chevron = false, enabled = enabled, onClick = { move(repoRoot = destination.project.repoRoot) })
          for (session in destination.sessions) {
            ListRow(SessionActivity.title(session), icon = Icon.branch, chevron = false, enabled = enabled, onClick = { move(sessionId = session.id) })
          }
        }
      }
      item { Box(Modifier.height(16.dp)) }
    }
  }
}
