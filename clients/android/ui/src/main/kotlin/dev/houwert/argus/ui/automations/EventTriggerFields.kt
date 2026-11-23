package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.automations.defaultSignalTrigger
import dev.houwert.argus.core.automations.defaultWebhookTrigger
import dev.houwert.argus.core.automations.signalError
import dev.houwert.argus.core.automations.signalEventOptions
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteSignalEventKind
import dev.houwert.argus.kit.protocol.generated.RemoteSignalTrigger
import dev.houwert.argus.kit.protocol.generated.RemoteSignalTriggerFire
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTriggerFire
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.TextKeyboard
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.ToggleList
import dev.houwert.argus.ui.components.ToggleOption
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** Rotates the automation's webhook secret on the computer; null when it refused. */
typealias RotateWebhook = suspend () -> MethodsTypes.AutomationsRotateWebhookResult?

/** What a signal trigger reacts to: the events, a label filter, and how runs are batched and capped. */
@Composable
internal fun SignalTriggerFields(draft: RemoteAutomationDetail, onChange: (RemoteAutomationDetail) -> Unit) {
  val signal = draft.signal ?: defaultSignalTrigger
  val update = { next: RemoteSignalTrigger -> onChange(draft.copy(signal = next)) }
  ToggleList(
    signalEventOptions.map { (kind, label) -> ToggleOption(kind.rawValue, label) },
    signal.on.map { it.rawValue },
    { picked -> update(signal.copy(on = EventTriggerText.ordered(picked))) },
    title = "Events",
  )
  draft.signalError?.let { Text(it, color = ArgusTheme.colors.error, style = argusFont(13)) }
  var labels by rememberSaveable { mutableStateOf(signal.labels.joinToString(", ")) }
  ThemedTextField(
    labels,
    { text ->
      labels = text
      update(signal.copy(labels = EventTriggerText.labels(text)))
    },
    "Labels, blank matches any", input = TextInput.Code,
  )
  FireAndCap(
    each = signal.fire == RemoteSignalTriggerFire.each,
    maxRunsPerHour = signal.maxRunsPerHour,
    onFire = { update(signal.copy(fire = if (it) RemoteSignalTriggerFire.each else RemoteSignalTriggerFire.batch)) },
    onCap = { update(signal.copy(maxRunsPerHour = it)) },
  )
}

/** A webhook trigger: its URL, the secret (shown once), and how runs are batched and capped. */
@Composable
internal fun WebhookTriggerFields(
  draft: RemoteAutomationDetail,
  onChange: (RemoteAutomationDetail) -> Unit,
  hasControl: Boolean,
  rotate: RotateWebhook?,
) {
  val webhook = draft.webhook ?: defaultWebhookTrigger
  val scope = rememberCoroutineScope()
  val clipboard = LocalClipboardManager.current
  var secret by remember(draft.id) { mutableStateOf<String?>(null) }
  var rotating by remember { mutableStateOf(false) }

  when {
    draft.id.isEmpty() -> MutedText("Save the automation to get its URL and secret.")
    webhook.url == null -> MutedText("Turn on remote access on the computer to get a URL for this webhook.")
    else -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
      MonoText(webhook.url!!, size = 13)
      Btn("Copy URL", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.copy) {
        clipboard.setText(AnnotatedString(webhook.url!!))
      }
    }
  }
  if (draft.id.isNotEmpty() && hasControl && rotate != null) {
    Btn(
      if (webhook.hasSecret) "Regenerate secret" else "Generate secret",
      tone = ButtonTone.Secondary, small = true, hugs = true, busy = rotating, enabled = !rotating,
    ) {
      rotating = true
      scope.launch {
        rotate()?.let { result ->
          secret = result.secret
          onChange(draft.copy(webhook = webhook.copy(url = result.url, hasSecret = true)))
        }
        rotating = false
      }
    }
  }
  secret?.let { value ->
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
      MonoText(value, size = 13)
      Btn("Copy secret", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.copy) {
        clipboard.setText(AnnotatedString(value))
      }
      MutedText("Copy it now: it won't be shown again.")
    }
  }
  MutedText(EventTriggerText.WEBHOOK_SIGNING)
  FireAndCap(
    each = webhook.fire == RemoteWebhookTriggerFire.each,
    maxRunsPerHour = webhook.maxRunsPerHour,
    onFire = { onChange(draft.copy(webhook = webhook.copy(fire = if (it) RemoteWebhookTriggerFire.each else RemoteWebhookTriggerFire.batch))) },
    onCap = { onChange(draft.copy(webhook = webhook.copy(maxRunsPerHour = it))) },
  )
}

@Composable
private fun FireAndCap(each: Boolean, maxRunsPerHour: Double, onFire: (Boolean) -> Unit, onCap: (Double) -> Unit) {
  SegmentedControl(each, listOf(true to "One per event", false to "One for everything new"), onChange = onFire)
  // Keep what was typed until it parses: rejecting mid-edit text would fight every keystroke.
  var text by rememberSaveable { mutableStateOf(GuardrailText.format(maxRunsPerHour)) }
  Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    MutedText("Runs per hour: at most 1 to 60; anything past it waits.")
    ThemedTextField(
      text,
      { typed ->
        text = typed
        onCap(EventTriggerText.maxRuns(typed))
      },
      "4", keyboard = TextKeyboard.DecimalPad, mono = true, input = TextInput.Code,
    )
  }
}

object EventTriggerText {
  const val SIGNAL_CAPTION = "Checked every 2 minutes. Linear only reports New issue and Assigned to me, when it's connected " +
    "on the computer; New issue and New pull request only watch this automation's projects."
  const val WEBHOOK_CAPTION = "Runs when a signed POST reaches this automation's URL on the computer."
  const val WEBHOOK_SIGNING = "Sign the body with X-Hub-Signature-256: sha256=<HMAC of the body>, " +
    "or send Authorization: Bearer <secret>."

  /** The picked events in the picker's order, unknown ids dropped. */
  fun ordered(picked: List<String>): List<RemoteSignalEventKind> =
    signalEventOptions.map { it.first }.filter { it.rawValue in picked }

  fun labels(text: String): List<String> = text.split(',').map { it.trim() }.filter { it.isNotEmpty() }

  /** A whole number of runs between 1 and 60; anything else falls back to the default 4. */
  fun maxRuns(typed: String): Double {
    val value = typed.trim().replace(',', '.').toDoubleOrNull()?.toInt() ?: return 4.0
    return value.coerceIn(1, 60).toDouble()
  }
}
