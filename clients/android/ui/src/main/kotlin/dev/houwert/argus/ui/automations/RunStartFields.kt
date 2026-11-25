package dev.houwert.argus.ui.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.TextKeyboard
import dev.houwert.argus.ui.components.ThemedTextField

/** What happens before a run's agent starts: an optional precheck that must exit 0, and whether it continues the last conversation. */
@Composable
fun RunStartFields(draft: RemoteAutomationDetail, onChange: (RemoteAutomationDetail) -> Unit) {
  Field("Before each run", caption = RunStartText.PRECHECK_CAPTION) {
    if (draft.precheckCommand != null) {
      MutedText("Precheck command: blank runs every time.")
      ThemedTextField(
        draft.precheckCommand.orEmpty(), { onChange(draft.copy(precheckCommand = it)) },
        "./scripts/has-new-work.sh", mono = true, input = TextInput.Code,
      )
      MutedText("Timeout (seconds)")
      // Keep what was typed until it parses, as the guardrail numbers do.
      var timeout by rememberSaveable {
        mutableStateOf(GuardrailText.format(draft.precheckTimeoutSeconds ?: RunStartText.DEFAULT_TIMEOUT))
      }
      ThemedTextField(
        timeout,
        { typed ->
          timeout = typed
          onChange(draft.copy(precheckTimeoutSeconds = RunStartText.timeout(typed)))
        },
        "60", keyboard = TextKeyboard.DecimalPad, mono = true, input = TextInput.Code,
      )
    }
    draft.continueConversation?.let { continues ->
      SwitchRow("Continue the previous run's conversation", continues) { onChange(draft.copy(continueConversation = it)) }
      MutedText(RunStartText.CONTINUE_CAPTION)
    }
  }
}

object RunStartText {
  const val PRECHECK_CAPTION =
    "Runs in the first project in scope. Exit 0 starts the run; any other exit, or no answer in time, " +
      "records it as skipped with the output."
  const val DEFAULT_TIMEOUT = 60.0
  const val CONTINUE_CAPTION =
    "Each run picks up where the last one stopped, with everything it read and decided. " +
      "When that conversation is gone, the run starts fresh and says so."

  /** A typed timeout in whole seconds, or the default while it isn't a positive number. */
  fun timeout(typed: String): Double =
    typed.trim().toDoubleOrNull()?.takeIf { it >= 1 }?.let { Math.rint(it) } ?: DEFAULT_TIMEOUT
}
