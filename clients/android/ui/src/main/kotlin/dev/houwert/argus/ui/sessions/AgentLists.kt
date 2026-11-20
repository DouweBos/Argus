package dev.houwert.argus.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.ChatHits
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.filterChats
import dev.houwert.argus.core.stores.loadStoppedAgents
import dev.houwert.argus.core.stores.repoRoot
import dev.houwert.argus.core.stores.searchChatHistory
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.AgentRow
import dev.houwert.argus.ui.components.ChromeSearchField
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.delay

val RemoteAgentStatusStatus.tone: Tone
  get() = when (this) {
    RemoteAgentStatusStatus.running -> Tone.Accent
    RemoteAgentStatusStatus.requiresAction -> Tone.Warning
    RemoteAgentStatusStatus.error -> Tone.Danger
    RemoteAgentStatusStatus.stopped -> Tone.Success
    else -> Tone.Muted
  }

/** One agent across projects: where it works ("Argus · main") tells them apart. */
@Composable
fun AgentStatusRow(host: HostStore, agent: RemoteAgentStatus, modifier: Modifier = Modifier, meta: String? = null) {
  val location = listOfNotNull(agent.projectName, agent.sessionLabel).filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { null }
  val attention = Labels.awaitingLabel(agent)
  AgentRow(
    Labels.agentName(agent), if (attention != null) Tone.Warning else agent.status.tone, modifier,
    running = agent.status == RemoteAgentStatusStatus.running, attention = attention,
    meta = meta ?: location ?: Labels.statusLabel(agent.status), project = agent.projectName, projectKey = host.repoRoot(agent),
  )
}

/** "3 total · 1 running · 2 idle · 0 errored", as the desktop's overview says. */
fun agentsSummary(agents: List<RemoteAgentStatus>): String {
  fun count(state: RemoteAgentStatusStatus) = agents.count { it.status == state }
  return "${agents.size} total · ${count(RemoteAgentStatusStatus.running)} running · ${count(RemoteAgentStatusStatus.idle)} idle · ${count(RemoteAgentStatusStatus.error)} errored"
}

/** Search a project's saved chats by title and message text; picking one hands it back to open. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatSearchSheet(host: HostStore, repoRoot: String, onOpen: (RemoteStoppedAgent) -> Unit, onSearched: () -> Unit, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  val stoppedByRepo by host.stoppedByRepo.collectAsState()
  var query by remember { mutableStateOf("") }
  var hits by remember { mutableStateOf<ChatHits?>(null) }
  var answered by remember { mutableStateOf<String?>(null) }
  var counted by remember { mutableStateOf(false) }
  val needle = query.trim()
  val shown = HostStore.filterChats(stoppedByRepo[repoRoot].orEmpty(), needle, hits)

  LaunchedEffect(repoRoot) { host.loadStoppedAgents(repoRoot) }
  LaunchedEffect(needle) {
    if (needle.isEmpty()) return@LaunchedEffect
    delay(200)
    val matches = host.searchChatHistory(repoRoot, needle)
    answered = needle
    if (matches != null) hits = ChatHits(needle, matches)
  }

  ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = theme.bg) {
    Column(Modifier.fillMaxSize()) {
      Text("Saved Chats", Modifier.padding(horizontal = 16.dp), color = theme.text, style = ArgusTheme.typography.headline)
      ChromeSearchField(
        query, { query = it; if (!counted && it.isNotEmpty()) { counted = true; onSearched() } },
        Modifier.padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth(), placeholder = "Search chats and messages",
      )
      Box(Modifier.fillMaxSize()) {
        when {
          shown.isEmpty() && (stoppedByRepo[repoRoot] == null || (needle.isNotEmpty() && answered != needle)) ->
            Loading(if (needle.isEmpty()) "Reading saved chats" else "Searching")
          shown.isEmpty() -> EmptyState(
            Icon.history, if (needle.isEmpty()) "No saved chats" else "No matches",
            body = if (needle.isEmpty()) "Chats this project's agents have finished show up here." else "No chat mentions “$needle”.",
          )
          else -> LazyColumn {
            items(shown, key = { it.historyId }) { chat ->
              Column(
                Modifier.fillMaxWidth().argusClickable(rememberInteraction(), label = chat.title) { onDismiss(); onOpen(chat) }
                  .padding(horizontal = 16.dp, vertical = 10.dp),
              ) {
                StoppedAgentRow(chat)
                if (needle.isNotEmpty()) hits?.matches?.get(chat.historyId).orEmpty().forEach { MatchSnippet(it) }
              }
              HorizontalDivider(Modifier.padding(start = 16.dp), color = theme.borderSubtle)
            }
          }
        }
      }
    }
  }
}
