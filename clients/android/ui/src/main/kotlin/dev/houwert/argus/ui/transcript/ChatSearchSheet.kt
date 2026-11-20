package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.ChatHistoryMatch
import dev.houwert.argus.core.stores.ChatHits
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.filterChats
import dev.houwert.argus.core.stores.loadStoppedAgents
import dev.houwert.argus.core.stores.parts
import dev.houwert.argus.core.stores.searchChatHistory
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.isImported
import dev.houwert.argus.kit.protocol.isPinned
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.ChromeSearchField
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.FormSheet
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.delay

/**
 * Search a project's saved chats by title and message text, as the Mac's Recent Chats does;
 * picking one hands it back to [open]. [searched] hears the first keystroke of a search.
 */
@Composable
fun ChatSearchSheet(
  host: HostStore,
  repoRoot: String,
  onDismiss: () -> Unit,
  open: (RemoteStoppedAgent) -> Unit,
  searched: () -> Unit = {},
) {
  val theme = ArgusTheme.colors
  var query by rememberSaveable { mutableStateOf("") }
  var hits by remember { mutableStateOf<ChatHits?>(null) }
  var counted by remember { mutableStateOf(false) }
  // The last query the host answered, hits or not, so "No matches" waits for it.
  var answered by remember { mutableStateOf<String?>(null) }
  val stopped by host.stoppedByRepo.collectAsState()
  val needle = query.trim()
  val chats = stopped[repoRoot]
  val shown = HostStore.filterChats(chats.orEmpty(), needle, hits)

  LaunchedEffect(repoRoot) { host.loadStoppedAgents(repoRoot) }
  LaunchedEffect(needle) {
    if (needle.isEmpty()) return@LaunchedEffect
    delay(200)
    val matches = host.searchChatHistory(repoRoot, needle)
    answered = needle
    if (matches != null) hits = ChatHits(needle, matches)
  }

  FormSheet("Saved Chats", onDismiss, cancelLabel = "Done") {
    ChromeSearchField(
      query,
      {
        query = it
        if (!counted && it.isNotEmpty()) {
          counted = true
          searched()
        }
      },
      Modifier.fillMaxWidth().background(theme.bgTertiary, RoundedCornerShape(ArgusMetrics.radiusSmall)).padding(4.dp),
      placeholder = "Search chats & messages",
    )
    when {
      shown.isEmpty() && (chats == null || (needle.isNotEmpty() && answered != needle)) ->
        Loading(if (needle.isEmpty()) "Reading saved chats" else "Searching")
      shown.isEmpty() ->
        Box(Modifier.fillMaxWidth().heightIn(min = 240.dp)) {
          EmptyState(
            Icon.history, if (needle.isEmpty()) "No saved chats" else "No matches",
            body = if (needle.isEmpty()) "Chats this project's agents have finished show up here." else "No chat mentions “$needle”.",
          )
        }
      else -> ListSection {
        for (chat in shown) {
          Column(
            Modifier.fillMaxWidth()
              .argusClickable(rememberInteraction(), label = chat.title) {
                onDismiss()
                open(chat)
              }
              .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
          ) {
            StoppedAgentRow(chat)
            if (needle.isNotEmpty()) for (match in hits?.matches?.get(chat.historyId).orEmpty()) MatchSnippet(match)
          }
        }
      }
    }
  }
}

/** A saved chat: its title, when it ended, how long it ran, and its branch unless [showBranch] is off. */
@Composable
fun StoppedAgentRow(agent: RemoteStoppedAgent, modifier: Modifier = Modifier, showBranch: Boolean = true) {
  val theme = ArgusTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(if (agent.isPinned) Icon.pin else Icon.history, null, Modifier.size(15.dp), tint = theme.accent)
      Text(agent.title, color = theme.text, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Text(
        "${Labels.timeAgo(agent.endedAt)} · ${agent.messageCount} messages" + if (showBranch) " · ${agent.branch}" else "",
        Modifier.weight(1f, fill = false), color = theme.textSecondary, style = argusFont(13), maxLines = 1, overflow = TextOverflow.Ellipsis,
      )
      if (agent.isImported) Badge("Imported")
    }
  }
}

/** A saved chat's message line that matched the search, its hit in bold. */
@Composable
fun MatchSnippet(match: ChatHistoryMatch, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val parts = match.parts
  val role = when (match.role.rawValue) {
    "assistant" -> "Assistant"
    "system" -> "System"
    else -> "You"
  }
  Text(
    buildAnnotatedString {
      withStyle(SpanStyle(color = theme.textMuted)) { append(role) }
      append("  ")
      append(parts.before)
      withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = theme.text)) { append(parts.hit) }
      append(parts.after)
    },
    modifier.padding(top = 2.dp), color = theme.textSecondary, style = argusFont(12), maxLines = 2, overflow = TextOverflow.Ellipsis,
  )
}
