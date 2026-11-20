package dev.houwert.argus.ui.blueprints

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.blueprints.BlueprintForm
import dev.houwert.argus.core.stores.BlueprintsStore
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import androidx.compose.runtime.collectAsState
import kotlinx.coroutines.launch

/** What a rewrite sheet calls its text and its states. */
data class ReviseTextCopy(
  val title: String,
  val subtitle: String,
  val placeholder: String,
  val explanation: String,
  /** "Nothing is saved until you save the automation." */
  val savedHint: String,
  /** The rewritten text's label, e.g. "Revised playbook". */
  val resultLabel: String,
  /** Shown while Claude works, e.g. "Rewriting the playbook". */
  val progress: String,
)

/**
 * Rewrite a piece of text by describing what should change. The rewrite lands in the editor's
 * draft, never on the computer: nothing changes until the screen underneath saves.
 * [revise] returns the rewritten text, or null with [error] set.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviseTextSheet(
  copy: ReviseTextCopy,
  error: String?,
  revise: suspend (String) -> String?,
  onApply: (String) -> Unit,
  onDismiss: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  var instruction by rememberSaveable { mutableStateOf("") }
  var revised by rememberSaveable { mutableStateOf<String?>(null) }
  var revising by remember { mutableStateOf(false) }
  val focus = remember { FocusRequester() }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
  val canRevise = instruction.isNotBlank() && !revising
  val canApply = !revising && !revised.isNullOrBlank()

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = theme.bg,
    contentColor = theme.text,
  ) {
    Column(Modifier.navigationBarsPadding().imePadding()) {
      Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(44.dp), contentAlignment = Alignment.Center) {
        AccentLink("Cancel", Modifier.align(Alignment.CenterStart), size = 17, onClick = onDismiss)
        Text(copy.title, color = theme.text, style = ArgusTheme.typography.headline)
        AccentLink("Apply", Modifier.align(Alignment.CenterEnd), size = 17, enabled = canApply) {
          revised?.let(onApply)
          onDismiss()
        }
      }
      Column(
        Modifier.verticalScroll(rememberScrollState()).padding(ArgusMetrics.space),
        verticalArrangement = Arrangement.spacedBy(ArgusMetrics.space),
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
            tone = ButtonTone.Secondary, small = true, busy = revising, enabled = canRevise,
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
          Field(copy.resultLabel, caption = "Edit it here if you want. ${copy.savedHint}") {
            ThemedTextField(text, { revised = it }, copy.resultLabel, multiline = true, lines = 8..24, mono = true)
          }
        }
      }
    }
  }
}

/** Rewrite a blueprint's instructions by describing what Claude got wrong; Claude may re-read the reference projects. */
@Composable
fun ReviseBlueprintSheet(store: BlueprintsStore, form: BlueprintForm, onApply: (String) -> Unit, onDismiss: () -> Unit) {
  val error by store.error.collectAsState()
  ReviseTextSheet(
    copy = ReviseTextCopy(
      title = "Revise the Instructions",
      subtitle = "Say what's wrong or missing; Claude rewrites the instructions and checks the reference projects.",
      placeholder = "Leave out the Node setup; the new app is Swift only.",
      explanation = "The instructions are rewritten around this; the rest is kept.",
      savedHint = "Nothing is saved until you save the blueprint.",
      resultLabel = "Revised instructions",
      progress = "Revising the instructions",
    ),
    error = error,
    revise = { note -> store.revise(form, note) },
    onApply = onApply,
    onDismiss = onDismiss,
  )
}
