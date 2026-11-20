package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.ArgusSwitch
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusToggleable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * Arguing with a report. The note goes to the run's own agent, which picks up where it stopped
 * and publishes a corrected report. By default feedback only adds proposals, so disagreeing
 * about one thing can't quietly empty the inbox; the switch is the user saying "take that out".
 * [send] returns whether the computer took it.
 */
@Composable
fun RunFeedbackSheet(
  error: String?,
  send: suspend (note: String, allowClearing: Boolean) -> Boolean,
  onDismiss: () -> Unit,
) {
  val state = rememberFeedbackState()
  val scope = rememberCoroutineScope()
  FormSheet(
    "Give Feedback", onDismiss, confirmLabel = if (state.sending) "Sending" else "Send", confirmEnabled = state.canSend,
    onConfirm = {
      state.sending = true
      scope.launch {
        val ok = send(state.note, state.allowClearing)
        state.sending = false
        if (ok) onDismiss()
      }
    },
  ) { RunFeedbackFields(state, error) }
}

class RunFeedbackState {
  var note by mutableStateOf("")
  var allowClearing by mutableStateOf(false)
  var sending by mutableStateOf(false)
  val canSend: Boolean get() = note.isNotBlank() && !sending
}

@Composable
fun rememberFeedbackState(): RunFeedbackState = remember { RunFeedbackState() }

@Composable
fun RunFeedbackFields(state: RunFeedbackState, error: String?, autofocus: Boolean = true) {
  val focus = remember { FocusRequester() }
  if (autofocus) LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  if (error != null) Banner(error, tone = Tone.Danger)
  Field(
    "What did it get wrong?",
    caption = "The run's agent picks up where it left off, checks what it claimed, and publishes a corrected report.",
  ) {
    ThemedTextField(
      state.note, { state.note = it },
      "The flaky snapshot test isn't a nice-to-have. It has failed every morning for a week.",
      Modifier.focusRequester(focus), multiline = true, lines = 3..8,
    )
  }
  Field(
    "Let it remove proposals",
    caption = "Off, feedback can only add to the inbox. Turn it on only if you are asking for something in there to go.",
  ) {
    SwitchRow("It may withdraw or supersede what your note names", state.allowClearing) { state.allowClearing = it }
  }
}

/** A labelled switch whose whole row toggles it. */
@Composable
fun SwitchRow(label: String, checked: Boolean, modifier: Modifier = Modifier, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
  val interaction = rememberInteraction()
  Row(
    modifier.fillMaxWidth().argusToggleable(checked, interaction, enabled, role = Role.Switch, onValueChange = onChange).padding(vertical = 4.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Text(label, Modifier.weight(1f), color = ArgusTheme.colors.text, style = argusFont(14))
    ArgusSwitch(checked, null, enabled = enabled)
  }
}
