package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.SlackConnectionState
import dev.houwert.argus.kit.protocol.generated.SlackStatus
import dev.houwert.argus.kit.util.Labels
import java.io.File
import java.util.Collections
import java.util.WeakHashMap
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// Slack as the computer has it connected. Its tokens and allowlist decide who runs agents on that
// computer, so the phone only reads them; connecting and choosing people happen on the Mac.

private val slackByStore = Collections.synchronizedMap(WeakHashMap<HostStore, MutableStateFlow<SlackStatus?>>())

private val HostStore.slackFlow: MutableStateFlow<SlackStatus?>
  get() = slackByStore.getOrPut(this) { MutableStateFlow(null) }

/** Null until loaded, and on a computer too old to have Slack. */
val HostStore.slackStatus: StateFlow<SlackStatus?> get() = slackFlow

suspend fun HostStore.loadSlackStatus() {
  val backend = backend ?: return
  slackFlow.value =
    try {
      backend.request(Methods.SlackStatus, MethodsTypes.SlackStatusParams()).status
    } catch (e: Exception) {
      if (HostStore.isCancellation(e)) throw e
      // An older computer has no Slack to report.
      null
    }
}

/** What the computer screen says about Slack, worded as the Mac's Settings → Integrations. */
object SlackStatusText {
  fun state(status: SlackStatus): String = when {
    !status.configured -> "Not connected"
    status.state == SlackConnectionState.connected -> "Connected"
    status.state == SlackConnectionState.connecting -> "Connecting"
    status.state == SlackConnectionState.error -> "Error"
    else -> "Off"
  }

  /** "Acme · Argus bot", or null before the first connection names the workspace. */
  fun workspace(status: SlackStatus): String? =
    listOfNotNull(status.workspace, status.botName).takeIf { it.isNotEmpty() }?.joinToString(" · ")

  fun owner(status: SlackStatus): String? = status.owner?.let { it.name ?: it.userId }

  fun projectName(repoRoot: String): String = File(repoRoot.trimEnd('/')).name.ifEmpty { repoRoot }

  fun channel(name: String): String = Labels.slackChannel(name)

  /** Where a message in an unmapped channel or a DM goes. */
  fun fallback(status: SlackStatus): String = status.defaultProject?.let { "Everything else → ${projectName(it)}" } ?: "Asks which project"
}
