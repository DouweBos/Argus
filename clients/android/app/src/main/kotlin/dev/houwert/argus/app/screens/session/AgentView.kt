package dev.houwert.argus.app.screens.session

import dev.houwert.argus.core.stores.MessageForkTarget
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
import dev.houwert.argus.core.stores.canResume
import dev.houwert.argus.core.stores.loadAgentStatus
import dev.houwert.argus.core.stores.loadRunners
import dev.houwert.argus.core.stores.reportViewing
import dev.houwert.argus.core.stores.resumeAgent
import dev.houwert.argus.core.stores.stopViewing
import dev.houwert.argus.core.stores.supportsTranscriptFork
import dev.houwert.argus.core.transcript.copyText
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.composer.ChatInputView
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.transcript.AgentTranscript
import dev.houwert.argus.ui.transcript.MessageEditSheet
import dev.houwert.argus.ui.transcript.MessageForkSheet
import dev.houwert.argus.ui.transcript.MessageMenu
import dev.houwert.argus.ui.transcript.MessageMenuAction
import dev.houwert.argus.ui.transcript.TranscriptFooterNote
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The edit or fork sheet a message's menu opened. */
private data class MessageSheet(val message: RemoteMessage, val fork: Boolean)

/**
 * One agent's transcript and the input that drives it: the body of a session
 * screen's tab. The screen around it owns the title and top bar. [stoppedFooter]
 * replaces the resume offer once the agent is gone.
 */
@Composable
fun AgentView(
  agentId: String,
  label: String,
  modifier: Modifier = Modifier,
  stoppedFooter: (@Composable () -> Unit)? = null,
  open: (RemoteAgentStatus, String) -> Unit,
) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val clipboard = LocalClipboardManager.current
  val statusByAgent by host.statusByAgent.collectAsState()
  val gone by host.goneAgents.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val runners by host.runners.collectAsState()
  val sessionId = statusByAgent[agentId]?.sessionId
  val isGone = agentId in gone || host.isGone(agentId)
  val hasControl = "control" in capabilities
  var sheet by remember { mutableStateOf<MessageSheet?>(null) }

  LaunchedEffect(agentId) {
    host.loadRunners()
    // Always asked: a cached status can belong to an agent that has since been shut down.
    host.loadAgentStatus(agentId)
  }
  // The computer keeps a warm agent in the session on screen, so the next start there is instant.
  DisposableEffect(sessionId, hasControl) {
    var token: Int? = null
    val job = if (hasControl && sessionId != null) scope.launch { token = host.reportViewing(sessionId) } else null
    onDispose {
      job?.cancel()
      token?.let { scope.launch { withContext(NonCancellable) { host.stopViewing(it) } } }
    }
  }

  val canChange = hasControl && !isGone && runners.let { host.supportsTranscriptFork(agentId) }
  val menu = remember(canChange) {
    MessageMenu(canChange) { action, message ->
      when (action) {
        MessageMenuAction.Copy -> message.copyText?.let {
          clipboard.setText(AnnotatedString(it))
          captureMessageAction(TelemetryEvent.MessageAction.Copy, message, true)
        }
        MessageMenuAction.Edit -> sheet = MessageSheet(message, fork = false)
        MessageMenuAction.Fork -> sheet = MessageSheet(message, fork = true)
      }
    }
  }

  Column(modifier.fillMaxSize().background(theme.bg)) {
    AgentTranscript(
      host = host,
      agentKey = agentId,
      modifier = Modifier.weight(1f),
      isLive = !isGone,
      messageMenu = menu,
      // File paths in the transcript open the viewer; reading needs control.
      onArtifactOpened = { Telemetry.capture(TelemetryEvent.ArtifactOpened) },
      onWorkLogOpened = { Telemetry.capture(TelemetryEvent.TranscriptWorkLogOpened(it)) },
      openFileLink = sessionId?.takeIf { hasControl }?.let { sid -> { ref -> router.push(Route.File(sid, ref.path, ref.line, "chat_link")) } },
    )
    when {
      isGone && stoppedFooter != null -> stoppedFooter()
      isGone -> StoppedFooter(agentId, hasControl) { open(it, label) }
      hasControl -> ChatInputView(
        host, agentId, sessionId,
        preferences = LocalAppStore.current.preferences,
        onAffordance = ::captureComposerInput,
        onOpenContinuedAgent = { open(it, Labels.agentName(it)) },
      )
    }
  }

  sheet?.let { current ->
    if (current.fork) {
      MessageForkSheet(host, agentId, current.message, onDismiss = { sheet = null }) { forked, target ->
        val action = if (target == MessageForkTarget.Session) TelemetryEvent.MessageAction.ForkSession else TelemetryEvent.MessageAction.ForkAgent
        captureMessageAction(action, current.message, forked != null)
        forked?.let { open(it.agent, Labels.agentName(it.agent)) }
      }
    } else {
      MessageEditSheet(host, agentId, current.message, onDismiss = { sheet = null }) { success ->
        captureMessageAction(TelemetryEvent.MessageAction.Edit, current.message, success)
      }
    }
  }
}

/** A control device picks the conversation back up in a fresh agent, as a saved chat does. */
@Composable
private fun StoppedFooter(agentId: String, hasControl: Boolean, opened: (RemoteAgentStatus) -> Unit) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  var resuming by remember { mutableStateOf(false) }
  if (hasControl && host.canResume(agentId)) {
    TranscriptFooterNote {
      MutedText("This agent has stopped.")
      Btn(if (resuming) "Resuming" else "Resume in a new agent", icon = Icon.plus, busy = resuming, enabled = !resuming) {
        resuming = true
        scope.launch {
          val agent = host.resumeAgent(agentId)
          resuming = false
          agent?.let(opened)
        }
      }
    }
  } else {
    TranscriptFooterNote("This agent has stopped, so it can't take new messages.")
  }
}
