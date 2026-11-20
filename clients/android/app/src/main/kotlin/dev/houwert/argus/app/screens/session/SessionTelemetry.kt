package dev.houwert.argus.app.screens.session

import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.ui.composer.ChatInputAffordance

/** A composer's input affordance, a chat's or a start's; ones the catalog doesn't name aren't counted. */
fun captureComposerInput(affordance: ChatInputAffordance) {
  if (affordance == ChatInputAffordance.FollowUp) return Telemetry.capture(TelemetryEvent.FollowUpUsed)
  val known = TelemetryEvent.InputAffordance.entries.firstOrNull { it.wire == affordance.rawValue } ?: return
  Telemetry.capture(TelemetryEvent.InputUsed(known))
}

fun captureSessionUsed(action: TelemetryEvent.SessionAction) = Telemetry.capture(TelemetryEvent.SessionUsed(action))

fun captureMessageAction(action: TelemetryEvent.MessageAction, message: RemoteMessage, success: Boolean) =
  Telemetry.capture(
    TelemetryEvent.MessageActionUsed(
      action,
      if (message.role == RemoteMessageRole.user) TelemetryEvent.MessageRole.User else TelemetryEvent.MessageRole.Assistant,
      success,
    ),
  )
