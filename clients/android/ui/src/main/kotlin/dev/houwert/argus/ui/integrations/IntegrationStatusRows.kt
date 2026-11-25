package dev.houwert.argus.ui.integrations

import androidx.compose.runtime.Composable
import dev.houwert.argus.core.stores.SlackStatusText
import dev.houwert.argus.kit.protocol.generated.IntegrationId
import dev.houwert.argus.kit.protocol.generated.IntegrationStatus
import dev.houwert.argus.kit.protocol.generated.SlackConnectionState
import dev.houwert.argus.kit.protocol.generated.SlackStatus
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.theme.Tone

/** The computer's Linear and Figma: one row each with who it's connected as and its state. */
@Composable
fun IntegrationStatusRows(integrations: List<IntegrationStatus>) {
  for (status in integrations) {
    SettingsRow(IntegrationLabels.name(status.id), description = IntegrationLabels.account(status)) {
      Badge(IntegrationLabels.state(status), tone = IntegrationLabels.tone(status))
    }
  }
}

/** No Slack workspace connected on the computer. */
@Composable
fun SlackNotConnectedRow() {
  SettingsRow("Connection") { Badge("Not connected", tone = Tone.Muted) }
}

/** One Slack workspace as the computer has it: connection, who owns it, and which channel works in which project. Read-only. */
@Composable
fun SlackStatusRows(status: SlackStatus) {
  val failed = status.state == SlackConnectionState.error
  SettingsRow(status.workspace ?: "Connection", description = if (failed) status.error else status.botName?.let { "@$it" }) {
    Badge(SlackStatusText.state(status), tone = IntegrationLabels.tone(status))
  }
  if (!status.configured) return
  SlackStatusText.owner(status)?.let { SettingsRow("Owner", description = it) }
  for (mapping in status.mappings) {
    SettingsRow("${SlackStatusText.channel(mapping.channelName)} → ${SlackStatusText.projectName(mapping.repoRoot)}")
  }
  SettingsRow(SlackStatusText.fallback(status))
}

object IntegrationLabels {
  fun name(id: IntegrationId): String = when (id) {
    IntegrationId.linear -> "Linear"
    IntegrationId.figma -> "Figma"
    else -> id.rawValue.replaceFirstChar { it.uppercase() }
  }

  fun state(status: IntegrationStatus): String = when {
    !status.connected -> "Not connected"
    status.needsReauth -> "Reconnect"
    else -> "Connected"
  }

  fun tone(status: IntegrationStatus): Tone = when {
    !status.connected -> Tone.Muted
    status.needsReauth -> Tone.Warning
    else -> Tone.Success
  }

  fun tone(status: SlackStatus): Tone = when {
    !status.configured -> Tone.Muted
    status.state == SlackConnectionState.connected -> Tone.Success
    status.state == SlackConnectionState.connecting -> Tone.Warning
    status.state == SlackConnectionState.error -> Tone.Danger
    else -> Tone.Muted
  }

  /** "Ada Lovelace · Acme", or null when nothing is connected. */
  fun account(status: IntegrationStatus): String? {
    val account = status.account?.takeIf { status.connected } ?: return null
    return listOfNotNull(account.name, account.workspace).joinToString(" · ")
  }
}
