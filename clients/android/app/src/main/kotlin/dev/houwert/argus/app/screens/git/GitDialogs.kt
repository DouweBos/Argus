package dev.houwert.argus.app.screens.git

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** One choice in a [ChoiceSheet]. */
class Choice(val label: String, val destructive: Boolean = false, val run: () -> Unit)

/** A yes-or-cancel question; [destructive] tints the confirm button. */
@Composable
fun ConfirmDialog(
  title: String,
  message: String?,
  confirmLabel: String,
  destructive: Boolean = false,
  onDismiss: () -> Unit,
  onConfirm: () -> Unit,
) {
  val theme = ArgusTheme.colors
  AlertDialog(
    onDismissRequest = onDismiss,
    containerColor = theme.surface,
    title = { Text(title, color = theme.text, style = argusFont(18, FontWeight.SemiBold)) },
    text = message?.let { { Text(it, color = theme.textSecondary, style = argusFont(14)) } },
    confirmButton = {
      TextButton({
        onDismiss()
        onConfirm()
      }) { Text(confirmLabel, color = if (destructive) theme.error else theme.accent, style = argusFont(15, FontWeight.SemiBold)) }
    },
    dismissButton = { TextButton(onDismiss) { Text("Cancel", color = theme.textSecondary, style = argusFont(15)) } },
  )
}

/** Several ways to go on, as a bottom sheet of rows: the Android form of an action sheet. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChoiceSheet(title: String, message: String?, choices: List<Choice>, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = theme.bgSecondary) {
    Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)) {
      Column(Modifier.padding(horizontal = 20.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, color = theme.text, style = argusFont(17, FontWeight.SemiBold))
        if (message != null) MutedText(message)
      }
      for (choice in choices) {
        ListRow(
          choice.label, chevron = false,
          tone = if (choice.destructive) dev.houwert.argus.ui.theme.Tone.Danger else null,
          onClick = {
            onDismiss()
            choice.run()
          },
        )
      }
    }
  }
}

/** A sheet with a title bar (cancel, title, confirm) over a scrolling form. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FormSheet(
  title: String,
  confirmLabel: String?,
  confirmEnabled: Boolean = true,
  cancelLabel: String = "Cancel",
  onDismiss: () -> Unit,
  onConfirm: () -> Unit = {},
  content: @Composable ColumnScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = theme.bg) {
    Column(Modifier.fillMaxWidth().imePadding().navigationBarsPadding()) {
      Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onDismiss) { Text(cancelLabel, color = theme.textSecondary, style = argusFont(15)) }
        Text(title, Modifier.weight(1f), color = theme.text, style = argusFont(16, FontWeight.SemiBold), maxLines = 1)
        if (confirmLabel != null) {
          TextButton(onConfirm, enabled = confirmEnabled) {
            Text(confirmLabel, color = if (confirmEnabled) theme.accent else theme.textMuted, style = argusFont(15, FontWeight.SemiBold))
          }
        }
      }
      Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
      )
    }
  }
}

/** Writing or editing one piece of text: a diff comment, a branch name. */
@Composable
fun TextSheet(
  title: String,
  submitLabel: String,
  initial: String = "",
  placeholder: String = "",
  multiline: Boolean = true,
  mono: Boolean = false,
  allowsUnchanged: Boolean = true,
  onDismiss: () -> Unit,
  onSubmit: (String) -> Unit,
) {
  var text by rememberSaveable { mutableStateOf(initial) }
  val trimmed = text.trim()
  val focus = remember { FocusRequester() }
  FormSheet(
    title, submitLabel, confirmEnabled = trimmed.isNotEmpty() && (allowsUnchanged || trimmed != initial),
    onDismiss = onDismiss,
    onConfirm = {
      onDismiss()
      onSubmit(trimmed)
    },
  ) {
    ThemedTextField(
      text, { text = it }, placeholder, Modifier.focusRequester(focus), multiline = multiline, lines = 4..12, mono = mono,
      input = if (mono) dev.houwert.argus.ui.components.TextInput.Code else dev.houwert.argus.ui.components.TextInput.Prose,
    )
  }
  LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
}
