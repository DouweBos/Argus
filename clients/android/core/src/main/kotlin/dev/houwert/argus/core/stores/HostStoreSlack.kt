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

// Slack as the computer has it connected. The phone may connect or disconnect each workspace's bot; who may use it
// (owner, allowlist, channel projects) decides who runs agents on that computer, so it's chosen on the Mac.

private val slackByStore = Collections.synchronizedMap(WeakHashMap<HostStore, MutableStateFlow<List<SlackStatus>?>>())

private val HostStore.slackFlow: MutableStateFlow<List<SlackStatus>?>
  get() = slackByStore.getOrPut(this) { MutableStateFlow(null) }

/** Every Slack workspace the computer knows; null until loaded, and on a computer too old to have Slack. */
val HostStore.slackWorkspaces: StateFlow<List<SlackStatus>?> get() = slackFlow

suspend fun HostStore.loadSlackStatus() {
  val backend = backend ?: return
  slackFlow.value =
    try {
      val result = backend.request(Methods.SlackStatus, MethodsTypes.SlackStatusParams())
      // A computer from before several workspaces sends only `status`, possibly one never connected.
      result.workspaces ?: listOf(result.status).filter { it.configured || it.workspace != null }
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

/** The manifest to create the Slack app from, for the clipboard. */
suspend fun HostStore.slackManifest(): String {
  val backend = backend ?: return ""
  return backend.request(Methods.SlackManifest, MethodsTypes.SlackManifestParams()).manifest
}

/** The tokens go to the computer's secret store; the answer carries the claim code for this phone to show. */
suspend fun HostStore.connectSlack(botToken: String, appToken: String) {
  val backend = backend ?: return
  slackFlow.value = backend.request(Methods.SlackConnect, MethodsTypes.SlackConnectParams(botToken.trim(), appToken.trim())).workspaces
}

suspend fun HostStore.disconnectSlack(teamId: String) {
  val backend = backend ?: return
  slackFlow.value = backend.request(Methods.SlackDisconnect, MethodsTypes.SlackDisconnectParams(teamId)).workspaces
}
