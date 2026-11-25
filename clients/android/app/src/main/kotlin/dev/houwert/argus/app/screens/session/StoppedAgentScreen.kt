package dev.houwert.argus.app.screens.session

import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.app.telemetry.Telemetry
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.deleteChatHistory
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.core.stores.resumeChat
import dev.houwert.argus.core.stores.setPinned
import dev.houwert.argus.core.stores.spawnAgent
import dev.houwert.argus.core.stores.stoppedChat
import dev.houwert.argus.core.stores.stoppedKey
import dev.houwert.argus.core.transcript.copyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ConfirmDialog
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.transcript.AgentTranscript
import dev.houwert.argus.ui.transcript.MessageMenu
import dev.houwert.argus.ui.transcript.MessageMenuAction
import dev.houwert.argus.ui.transcript.TranscriptFooterNote
import kotlinx.coroutines.launch

/**
 * A finished agent's transcript, read back from the computer's saved history.
 * Read-only (the process is gone), but a control device can pick the
 * conversation back up in a fresh agent.
 */
@Composable
fun StoppedAgentScreen(route: Route.StoppedAgent) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val clipboard = LocalClipboardManager.current
  val sessionsByRepo by host.sessionsByRepo.collectAsState()
  @Suppress("UNUSED_VARIABLE") val stopped by host.stoppedByRepo.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val chat = host.stoppedChat(route.repoRoot, route.historyId)
  // Resuming needs somewhere to run: the session still on this branch.
  val session = sessionsByRepo[route.repoRoot].orEmpty().firstOrNull { it.branch == route.branch }
  var resuming by remember { mutableStateOf(false) }
  var confirmingDelete by remember { mutableStateOf(false) }

  LaunchedEffect(route.repoRoot) { host.loadSessions(route.repoRoot) }
  DisposableEffect(router) {
    router.sessionNav.chatsShown.value += 1
    onDispose { router.sessionNav.chatsShown.value -= 1 }
  }

  // A saved chat only copies; there is no live conversation to edit or fork.
  val menu = remember {
    MessageMenu(false) { action, message ->
      if (action == MessageMenuAction.Copy) message.copyText?.let {
        clipboard.setText(AnnotatedString(it))
        captureMessageAction(TelemetryEvent.MessageAction.Copy, message, true)
      }
    }
  }

  Column(Modifier.fillMaxSize().background(theme.bg)) {
    SessionTopBar(route.label, null, onBack = router::pop) {
      if (session != null) {
        IconBtn(Icon.branch, "View changes") { router.push(Route.Changes(session.id, route.branch)) }
      }
      if (hasControl && chat != null && chat.importedFrom == null && (session != null || chat.pinned == true)) {
        val pinned = chat.pinned == true
        IconBtn(if (pinned) Icon.pinSlash else Icon.pin, if (pinned) "Unpin chat" else "Pin chat: resume it when Argus restarts") {
          scope.launch { host.setPinned(chat, route.repoRoot, !pinned) }
        }
      }
      if (hasControl) IconBtn(Icon.trash, "Delete chat") { confirmingDelete = true }
    }
    AgentTranscript(
      host = host,
      agentKey = HostStore.stoppedKey(route.repoRoot, route.historyId),
      modifier = Modifier.weight(1f),
      isLive = false,
      messageMenu = menu,
      onArtifactOpened = { Telemetry.capture(TelemetryEvent.ArtifactOpened) },
      onWorkLogOpened = { Telemetry.capture(TelemetryEvent.TranscriptWorkLogOpened(it)) },
      openDutyRun = { run -> router.push(Route.Run(run.runId, run.automationName)) },
    )
    TranscriptFooterNote {
      if (hasControl && session != null) {
        Btn(if (resuming) "Resuming" else "Resume in a new agent", icon = Icon.plus, busy = resuming, enabled = !resuming) {
          resuming = true
          scope.launch {
            // The runner it ran on, when the list has it; older hosts don't say.
            val agent = host.stoppedChat(route.repoRoot, route.historyId)?.let { host.resumeChat(it, session.id) }
              ?: host.spawnAgent(session.id, resumeSessionId = route.runnerSessionId)
            resuming = false
            agent?.let { router.push(Route.Agent(it.agentId, route.label)) }
          }
        }
      } else {
        MutedText(
          if (hasControl) "This agent's session is gone, so there's nothing to resume into."
          else "This agent has stopped. Grant this phone control in Argus on your computer to resume it.",
        )
      }
    }
  }

  if (confirmingDelete) {
    ConfirmDialog(
      title = "Delete this saved chat?",
      confirmLabel = "Delete",
      destructive = true,
      onConfirm = {
        confirmingDelete = false
        scope.launch {
          host.deleteChatHistory(route.repoRoot, listOf(route.historyId))
          Telemetry.capture(TelemetryEvent.ChatHistoryUsed(TelemetryEvent.ChatHistoryAction.Delete))
          router.pop()
        }
      },
      onDismiss = { confirmingDelete = false },
    )
  }
}
