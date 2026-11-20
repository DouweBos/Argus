package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.hasLoadedTranscript
import dev.houwert.argus.core.stores.loadOlderMessages
import dev.houwert.argus.core.stores.loadQueue
import dev.houwert.argus.core.stores.loadTranscript
import dev.houwert.argus.core.stores.refreshTranscript
import dev.houwert.argus.core.stores.watchAgent
import dev.houwert.argus.core.transcript.FileLinks
import dev.houwert.argus.core.transcript.PendingPrompts
import dev.houwert.argus.core.transcript.TranscriptItem
import dev.houwert.argus.core.transcript.TranscriptItems
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.util.Activity
import dev.houwert.argus.kit.util.ArtifactLink
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.OnResume
import dev.houwert.argus.ui.components.ReadingColumn
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.WorkingIndicator
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Work that must outlive the screen: an answer or an unsubscribe sent as the user leaves. */
private val detached = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

private const val BOTTOM_KEY = "transcript-bottom"
private const val OLDER_KEY = "transcript-older"

/**
 * The transcript: structured messages with inline tool calls, permission forms, task lists, queued
 * messages and the working indicator. Live-refreshes off agent events with a poll as a backstop,
 * and loads older history when you scroll to the top.
 *
 * It follows the newest message while you're at the bottom and stays put once you scroll up, with
 * a button back down. Built bottom-up (`reverseLayout`) so a reply growing in place stays pinned.
 */
@Composable
fun AgentTranscript(
  host: HostStore,
  agentKey: String,
  modifier: Modifier = Modifier,
  isLive: Boolean = true,
  messageMenu: MessageMenu? = null,
  openFileLink: ((FileLinks.FileRef) -> Unit)? = null,
  openArtifact: ((ArtifactLink) -> Unit)? = null,
  onArtifactOpened: () -> Unit = {},
  autoExpandImageReads: Boolean = false,
  onWorkLogOpened: (working: Boolean) -> Unit = {},
) {
  key(agentKey) {
    var shownArtifact by remember { mutableStateOf<ArtifactLink?>(null) }
    val latestOpened by rememberUpdatedState(onArtifactOpened)
    val artifacts = openArtifact ?: { link: ArtifactLink ->
      shownArtifact = link
      latestOpened()
    }
    val viewer = remember { ImageViewerState() }
    val expansion = remember { mutableStateMapOf<String, Boolean>() }
    val env = remember(host, messageMenu, openFileLink, openArtifact, autoExpandImageReads) {
      TranscriptEnvironment(
        host, agentKey, openFileLink, artifacts, messageMenu, autoExpandImageReads, viewer, expansion, detached,
      )
    }
    CompositionLocalProvider(LocalTranscript provides env, LocalOpenFileLink provides openFileLink) {
      TranscriptList(host, agentKey, isLive, autoExpandImageReads, onWorkLogOpened, modifier)
      ImageViewerOverlay(viewer, host)
      shownArtifact?.let { ArtifactSheet(it) { shownArtifact = null } }
    }

    LaunchedEffect(Unit) {
      host.loadTranscript(agentKey)
      if (!isLive) return@LaunchedEffect
      host.loadQueue(agentKey)
      host.watchAgent(agentKey, true)
      // Subscriptions are fire-and-forget, so an event before the gateway registered ours is lost
      // (the first question, usually). One catch-up fetch closes that window.
      delay(600)
      host.loadTranscript(agentKey)
    }
    DisposableEffect(Unit) {
      onDispose { if (isLive) detached.launch { host.watchAgent(agentKey, false) } }
    }
    val connection by host.connection.collectAsState()
    LiveRefresh(enabled = connection == Transport.State.Ready, interval = 5.seconds) { host.refreshTranscript(agentKey) }
    // Queue changes only arrive over the agent subscription, which a locked phone takes down with the socket.
    OnResume(connected = connection == Transport.State.Ready, enabled = isLive) {
      host.loadQueue(agentKey)
      host.watchAgent(agentKey, true)
    }
  }
}

@Composable
private fun TranscriptList(
  host: HostStore,
  agentKey: String,
  isLive: Boolean,
  hoistImageReads: Boolean,
  onWorkLogOpened: (Boolean) -> Unit,
  modifier: Modifier,
) {
  val theme = ArgusTheme.colors
  val server by host.messagesByAgent.collectAsState()
  val optimistic by host.optimisticByAgent.collectAsState()
  val prompts by host.prompts.collectAsState()
  val answered by host.answered.collectAsState()
  val statuses by host.statusByAgent.collectAsState()
  val pendingTools by host.pendingToolByAgent.collectAsState()
  val tasks by host.tasksByAgent.collectAsState()
  val todos by host.todosByAgent.collectAsState()
  val queued by host.queuedByAgent.collectAsState()
  val sending by host.sendingQueuedByAgent.collectAsState()
  val failed by host.failedByAgent.collectAsState()
  val outbox by host.outboxByAgent.collectAsState()
  val olderCursors by host.prevBeforeByAgent.collectAsState()
  val errors by host.transcriptErrorByAgent.collectAsState()

  val serverMessages = server[agentKey]
  val pendingMessages = optimistic[agentKey]
  val messages = remember(serverMessages, pendingMessages) { serverMessages.orEmpty() + pendingMessages.orEmpty() }
  // The rows, regrouped only where the messages changed; unchanged rows keep their instances, so they skip.
  val built = remember(hoistImageReads) { TranscriptItems(hoistImageReads) }
  val rows = remember(built, messages) {
    built.update(messages)
    built.items
  }
  val agentState = statuses[agentKey]?.status
  val pending = remember(agentKey, prompts, answered, agentState) {
    PendingSnapshot(agentKey, prompts.keys, answered, agentState)
  }
  val pendingCalls = remember(messages, pending) {
    PendingPrompts.pendingCalls(agentKey, messages, pending.promptKeys, pending.answered, agentState)
  }
  val hasPendingPermission = remember(messages, pending) { messages.any { m -> m.toolCalls.any(pending::hasPendingCall) } }
  val expandedLogs = remember { mutableStateMapOf<String, Boolean>() }
  val list = rememberLazyListState()
  val scope = rememberCoroutineScope()
  val hasOlder = agentKey in olderCursors

  // Scrolling the transcript by hand means you want to read it, not type.
  val keyboard = LocalSoftwareKeyboardController.current
  val dragged by list.interactionSource.collectIsDraggedAsState()
  LaunchedEffect(dragged) { if (dragged) keyboard?.hide() }

  val slack = with(LocalDensity.current) { 60.dp.roundToPx() }
  val atBottom by remember { derivedStateOf { list.firstVisibleItemIndex == 0 || (list.firstVisibleItemIndex == 1 && list.firstVisibleItemScrollOffset < slack) } }
  val overflows by remember { derivedStateOf { list.canScrollForward || list.canScrollBackward } }

  CompositionLocalProvider(LocalPending provides pending) {
    Box(modifier.fillMaxSize()) {
      LazyColumn(
        Modifier.fillMaxSize(),
        state = list,
        reverseLayout = true,
        // A chat shorter than the pane starts at the top, as a scroll view does.
        verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.Top),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(ArgusMetrics.space),
      ) {
        val column = Modifier.widthIn(max = ReadingColumn.MAX_WIDTH.dp).fillMaxWidth()
        // Bottom-up: the anchor, then what's waiting, then the turn's footer, then history newest first.
        item(BOTTOM_KEY) { Spacer(Modifier.height(1.dp)) }
        footer(agentKey, failed[agentKey].orEmpty(), outbox[agentKey].orEmpty(), queued[agentKey].orEmpty(), sending[agentKey].orEmpty(), column)
        if (pendingCalls.isNotEmpty()) item("prompts") { TranscriptPrompts(pendingCalls, column) }
        todos[agentKey]?.takeIf { it.isNotEmpty() }?.let { list ->
          item("todos") {
            TaskListView("Todos", list.map { TaskListItem(it.activeForm ?: it.content, dev.houwert.argus.kit.protocol.generated.RemoteTaskStatus(it.status.rawValue)) }, column)
          }
        }
        tasks[agentKey]?.takeIf { it.isNotEmpty() }?.let { list ->
          item("tasks") { TaskListView("Tasks", list.map { TaskListItem(it.activeForm ?: it.subject, it.status, it.owner) }, column) }
        }
        item("working") {
          AgentWorkingIndicator(agentState, pendingTools[agentKey], hasPendingPermission, column)
        }
        items(rows.asReversed(), key = { it.id }, contentType = { it::class }) { row ->
          when (row) {
            is TranscriptItem.Message -> TranscriptMessageView(row.message, column)
            is TranscriptItem.Run -> androidx.compose.foundation.layout.Column(column, verticalArrangement = Arrangement.spacedBy(10.dp)) {
              for (message in row.messages) TranscriptMessageView(message)
            }
            is TranscriptItem.Work -> WorkLogRow(
              row.log, expandedLogs[row.log.id] == true, { expandedLogs[row.log.id] = it }, column, onOpen = onWorkLogOpened,
            )
          }
        }
        if (hasOlder) item(OLDER_KEY) { OlderMessagesSentinel(host, agentKey) }
      }

      if (messages.isEmpty()) {
        val error = errors[agentKey]
        when {
          error != null -> EmptyState(Icon.warning, "Couldn't load this chat", body = error)
          !host.hasLoadedTranscript(agentKey) -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading("Reading chat") }
          else -> EmptyState(
            Icon.agent, "Nothing yet",
            body = if (isLive) "Send this agent a message to get it going." else "This conversation has no saved messages.",
          )
        }
      }

      if (overflows && !atBottom) {
        Box(
          Modifier.align(Alignment.BottomEnd).padding(ArgusMetrics.space).size(36.dp).clip(CircleShape)
            .background(theme.accent)
            .argusClickable(rememberInteraction(), shape = CircleShape, label = "Jump to latest") { scope.launch { list.animateScrollToItem(0) } },
          contentAlignment = Alignment.Center,
        ) {
          Icon(Icon.chevronDown, "Jump to latest", Modifier.size(18.dp), tint = theme.onAccent)
        }
      }
    }
  }
}

/** Under the queue because the queue is the computer's record and these are the absence of one. Bottom-up order. */
private fun androidx.compose.foundation.lazy.LazyListScope.footer(
  agentKey: String,
  failed: List<dev.houwert.argus.core.stores.FailedSend>,
  outbox: List<dev.houwert.argus.core.stores.FailedSend>,
  queued: List<dev.houwert.argus.kit.protocol.generated.RemoteQueuedMessage>,
  sending: List<dev.houwert.argus.kit.protocol.generated.RemoteQueuedMessage>,
  column: Modifier,
) {
  if (failed.isNotEmpty()) {
    items(failed.asReversed(), key = { "failed:${it.id}" }) { FailedSendCard(it, column) }
    item("failed-header") { SectionHeader("Not sent", column, count = failed.size) }
  }
  // Written while the computer was out of reach; sent when it's back.
  if (outbox.isNotEmpty()) {
    items(outbox.asReversed(), key = { "outbox:${it.id}" }) { FailedSendCard(it, column, waiting = true) }
    item("outbox-header") { SectionHeader("Waiting for connection", column, count = outbox.size) }
  }
  if (queued.isNotEmpty() || sending.isNotEmpty()) {
    items(sending.asReversed(), key = { "sending:${it.id}" }) { QueuedMessageCard(it, column, sending = true) }
    items(queued.asReversed(), key = { "queued:${it.id}" }) { QueuedMessageCard(it, column) }
    item("queued-header") { SectionHeader("Queued", column, count = queued.size + sending.size) }
  }
}

/** Scrolled into view, it loads older history. */
@Composable
private fun OlderMessagesSentinel(host: HostStore, agentKey: String) {
  var loading by remember { mutableStateOf(false) }
  LaunchedEffect(Unit) {
    loading = true
    host.loadOlderMessages(agentKey)
    loading = false
  }
  Row(
    Modifier.fillMaxWidth().height(28.dp),
    horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (loading) {
      CircularProgressIndicator(Modifier.size(12.dp), color = ArgusTheme.colors.textMuted, strokeWidth = 1.5.dp)
      MutedText("Loading earlier messages")
    }
  }
}

/** What the agent is doing right now; nothing while it's idle or stopped. One whimsical verb per thinking episode. */
@Composable
fun AgentWorkingIndicator(
  status: RemoteAgentStatusStatus?,
  pendingToolName: String?,
  hasPendingPermission: Boolean,
  modifier: Modifier = Modifier,
) {
  val description = Activity.derive(status, pendingToolName, null, hasPendingPermission)
  val thinking = description.text == "Thinking"
  // Re-rolled per episode, not per redraw, or the row flickers.
  val verb = remember(thinking) { Activity.randomSpinnerVerb() }
  if (description.state == Activity.State.WORKING || description.state == Activity.State.BLOCKED) {
    Box(modifier) { WorkingIndicator(if (thinking) verb else description.text, blocked = description.state == Activity.State.BLOCKED) }
  } else {
    // Zero height but present: the lazy list keeps its slot, so appearing doesn't shift the anchor.
    Spacer(modifier.height(0.dp))
  }
}
