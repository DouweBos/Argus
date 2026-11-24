package dev.houwert.argus.ui.automations

import dev.houwert.argus.core.automations.ReportTone
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.theme.Tone
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Labels the automation screens share, worded as the desktop app's. */
object AutomationText {
  fun timestamp(millis: Double, zone: ZoneId = ZoneId.systemDefault(), locale: Locale = Locale.getDefault()): String =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(zone)
      .format(Instant.ofEpochMilli(millis.toLong()))

  /** What a list shows under "next run". */
  fun nextRun(automation: RemoteAutomation): String {
    if (automation.triggerKind == RemoteAutomationTriggerKind.manual) return "Manual"
    if (!automation.enabled) return "Paused"
    if (automation.triggerKind == RemoteAutomationTriggerKind.signal) return "When an event arrives"
    if (automation.triggerKind == RemoteAutomationTriggerKind.webhook) return "When its webhook is called"
    if (automation.triggerKind == RemoteAutomationTriggerKind.slack) return "On the next matching message"
    val next = automation.nextRunAt ?: return "Not scheduled"
    return "${timestamp(next)} (${Labels.until(next) ?: "now"})"
  }

  fun plural(count: Int, noun: String): String = "$count $noun${if (count == 1) "" else "s"}"

  fun reportTone(tone: ReportTone?): Tone = when (tone) {
    ReportTone.Critical -> Tone.Danger
    ReportTone.Warning -> Tone.Warning
    ReportTone.Positive -> Tone.Success
    ReportTone.Info, null -> Tone.Accent
  }
}
