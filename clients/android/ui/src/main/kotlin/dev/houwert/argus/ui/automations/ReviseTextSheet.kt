package dev.houwert.argus.ui.automations

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** What a rewrite sheet calls its text and its states. */
data class ReviseTextCopy(
  val title: String,
  val placeholder: String,
  val explanation: String,
  val resultLabel: String,
) {
  companion object {
    val playbook = ReviseTextCopy(
      title = "Rewrite the Playbook",
      placeholder = "Check for a merged PR before calling a branch unshipped.",
      explanation = "The whole playbook is rewritten around this; the rest is kept.",
      resultLabel = "Revised playbook",
    )
    val soul = ReviseTextCopy(
      title = "Rewrite the Soul",
      placeholder = "Be terser in pull request reviews.",
      explanation = "The whole soul is rewritten around this; the rest is kept.",
      resultLabel = "Revised soul",
    )
  }
}

/**
 * Rewrite a piece of text by describing what should change. The rewrite lands in the editor's
 * draft, never on the computer: nothing changes until the screen underneath saves. [revise]
 * returns the rewritten text, or null with [error] set.
 */
@Composable
fun ReviseTextSheet(
  copy: ReviseTextCopy,
  error: String?,
  revise: suspend (instruction: String) -> String?,
  onApply: (String) -> Unit,
  onDismiss: () -> Unit,
) {
  var instruction by remember { mutableStateOf("") }
  var revised by remember { mutableStateOf<String?>(null) }
  var revising by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  val canRevise = instruction.isNotBlank() && !revising
  FormSheet(
    copy.title, onDismiss, confirmLabel = "Apply", confirmEnabled = !revising && !revised.isNullOrBlank(),
    onConfirm = {
      revised?.let(onApply)
      onDismiss()
    },
  ) {
    if (error != null) Banner(error, tone = Tone.Danger)
    Field("What should change?", caption = copy.explanation) {
      ThemedTextField(instruction, { instruction = it }, copy.placeholder, Modifier.focusRequester(focus), multiline = true, lines = 3..8)
      Btn(
        when {
          revising -> "Rewriting"
          revised == null -> "Rewrite"
          else -> "Rewrite again"
        },
        tone = ButtonTone.Secondary, small = true, hugs = true, busy = revising, enabled = canRevise,
      ) {
        revising = true
        scope.launch {
          val result = revise(instruction)
          revising = false
          if (result != null) revised = result
        }
      }
    }
    revised?.let { text ->
      Field(copy.resultLabel, caption = "Edit it here if you want.") {
        ThemedTextField(text, { revised = it }, copy.resultLabel, multiline = true, lines = 8..24, mono = true)
      }
    }
  }
}
