package dev.houwert.argus.app.screens.teammates

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.screens.automations.rememberHostAccess
import dev.houwert.argus.app.screens.session.AgentView
import dev.houwert.argus.core.stores.loadThreads
import dev.houwert.argus.core.stores.openThread
import dev.houwert.argus.kit.protocol.generated.OpenedTeammateThread
import dev.houwert.argus.kit.protocol.generated.TeammateThread
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.transcript.TranscriptFooterNote
import kotlinx.coroutines.launch

private const val READ_ONLY_NOTE = "This device can read conversations but not talk to teammates."

/**
 * Talking to a teammate: one conversation's transcript over the composer, its other
 * conversations and its pages in the top bar. Opening a conversation wakes its agent, which
 * needs control; a monitor device gets the conversation list and a read-only transcript.
 */
@Composable
fun TeammateScreen(id: String, label: String, threadId: String?) {
  val store = LocalAppStore.current.teammates
  val router = LocalRouter.current
  val access = rememberHostAccess()
  val scope = rememberCoroutineScope()
  val detailById by store.detailById.collectAsState()
  val summaries by store.teammates.collectAsState()
  val threadsById by store.threadsById.collectAsState()
  val error by store.error.collectAsState()
  var opened by remember { mutableStateOf<OpenedTeammateThread?>(null) }
  var opening by remember { mutableStateOf(false) }
  var openFailed by remember { mutableStateOf(false) }
  val name = (detailById[id]?.teammate ?: summaries.firstOrNull { it.teammate.id == id }?.teammate)?.name ?: label
  val threads = threadsById[id].orEmpty().filter { !it.archived }.sortedByDescending { it.lastOpenedAt }
  val currentThreadId = opened?.thread?.id ?: threadId

  fun show(thread: String) {
    // Another conversation is another route; swapping keeps back on the list.
    if (thread != currentThreadId) router.replaceTop(Route.Teammate(id, name, thread), 1)
  }

  fun open(fresh: Boolean = false) {
    opening = true
    openFailed = false
    scope.launch {
      val result = store.openThread(id, if (fresh) null else threadId, fresh)
      opening = false
      when {
        result == null -> openFailed = opened == null
        fresh -> show(result.thread.id)
        else -> opened = result
      }
    }
  }

  LaunchedEffect(id) {
    if (store.teammate(id) == null) store.loadDetail(id)
    store.loadThreads(id)
  }
  LaunchedEffect(id, threadId, access.hasControl) { if (access.hasControl) open() }

  AppScreen(
    name,
    actions = {
      ConversationsMenu(threads, currentThreadId, canStart = access.hasControl && access.ready && !opening, start = { open(fresh = true) }, pick = ::show)
      PagesMenu(id, name)
    },
  ) {
    val current = opened
    when {
      access.hasControl && current != null -> Conversation(current.agentId, name, waking = opening) { open() }
      access.hasControl && openFailed -> EmptyState(
        Icon.warning, "Couldn't open the conversation", body = error ?: "The computer didn't answer.",
      ) { Btn("Retry", tone = ButtonTone.Secondary, small = true, icon = Icon.refresh, hugs = true) { open() } }
      access.hasControl -> Loading("Waking $name")
      else -> threads.firstOrNull { it.id == threadId }?.let { ReadOnlyConversation(it.agentId, name) }
        ?: ThreadList(id, name, threads)
    }
  }
}

@Composable
private fun Conversation(agentId: String, name: String, waking: Boolean, wake: () -> Unit) {
  val router = LocalRouter.current
  AgentView(
    agentId, name,
    // A teammate's conversation outlives its agent; opening it again resumes it.
    stoppedFooter = {
      TranscriptFooterNote {
        MutedText("$name went to sleep.")
        Btn(if (waking) "Waking" else "Wake it up", icon = Icon.play, busy = waking, enabled = !waking, onClick = wake)
      }
    },
  ) { agent, label -> router.push(Route.Agent(agent.agentId, label)) }
}

@Composable
private fun ReadOnlyConversation(agentId: String, name: String) {
  val router = LocalRouter.current
  Column(Modifier.fillMaxSize()) {
    AgentView(agentId, name, Modifier.weight(1f), stoppedFooter = {}) { agent, label -> router.push(Route.Agent(agent.agentId, label)) }
    TranscriptFooterNote(READ_ONLY_NOTE)
  }
}

/** A monitor device's view: which conversations there are. */
@Composable
private fun ThreadList(id: String, name: String, threads: List<TeammateThread>) {
  val router = LocalRouter.current
  if (threads.isEmpty()) {
    EmptyState(Icon.chat, "No conversations", body = "A device with control can start one.")
    return
  }
  Screen {
    ListSection(footer = READ_ONLY_NOTE) {
      for (thread in threads) {
        ListRow(threadTitle(thread), subtitle = Labels.timeAgo(thread.lastOpenedAt), onClick = { router.push(Route.Teammate(id, name, thread.id)) })
      }
    }
  }
}

@Composable
private fun ConversationsMenu(
  threads: List<TeammateThread>,
  currentThreadId: String?,
  canStart: Boolean,
  start: () -> Unit,
  pick: (String) -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  Box {
    IconButton({ open = true }) { Icon(Icon.history, "Conversations") }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      if (canStart) {
        MenuItem("New conversation", Icon.compose) {
          open = false
          start()
        }
        if (threads.isNotEmpty()) HorizontalDivider()
      }
      for (thread in threads) {
        MenuItem(threadTitle(thread), if (thread.id == currentThreadId) Icon.check else null) {
          open = false
          pick(thread.id)
        }
      }
    }
  }
}

/** Profile, Duties and Memory: each a page of its own. */
@Composable
private fun PagesMenu(id: String, name: String) {
  val router = LocalRouter.current
  var open by remember { mutableStateOf(false) }
  Box {
    IconButton({ open = true }) { Icon(Icon.ellipsis, "More") }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      fun go(route: Route) {
        open = false
        router.push(route)
      }
      MenuItem("Profile", Icon.person) { go(Route.TeammateProfile(id, name)) }
      MenuItem("Duties", Icon.automations) { go(Route.TeammateDuties(id, name)) }
      MenuItem("Memory", Icon.model) { go(Route.TeammateMemory(id, name)) }
    }
  }
}

@Composable
private fun MenuItem(label: String, icon: ImageVector?, onClick: () -> Unit) {
  DropdownMenuItem(text = { Text(label) }, leadingIcon = icon?.let { { Icon(it, null) } }, onClick = onClick)
}

private fun threadTitle(thread: TeammateThread): String = thread.title.trim().ifEmpty { "New conversation" }
