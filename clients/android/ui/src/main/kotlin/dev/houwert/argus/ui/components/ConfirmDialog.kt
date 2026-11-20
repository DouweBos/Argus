package dev.houwert.argus.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusTheme

data class ConfirmChoice(val label: String, val destructive: Boolean = false, val run: () -> Unit)

/** A confirmation with several actions, stacked full width, Cancel last. */
@Composable
fun ConfirmChoicesDialog(title: String, choices: List<ConfirmChoice>, onDismiss: () -> Unit, message: String? = null) {
  val theme = ArgusTheme.colors
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title, style = ArgusTheme.typography.headline, color = theme.text) },
    text = message?.let { { Text(it, style = ArgusTheme.typography.subheadline, color = theme.textSecondary) } },
    confirmButton = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (choice in choices) {
          Btn(choice.label, tone = if (choice.destructive) ButtonTone.Danger else ButtonTone.Primary, fills = true) {
            onDismiss()
            choice.run()
          }
        }
        Btn("Cancel", tone = ButtonTone.Ghost, fills = true, onClick = onDismiss)
      }
    },
    containerColor = theme.surface,
  )
}

/** Asks for one line of text, as an alert with a field: Save stays off while it's blank. */
@Composable
fun PromptDialog(
  title: String,
  initial: String,
  placeholder: String,
  onSave: (String) -> Unit,
  onDismiss: () -> Unit,
  message: String? = null,
  input: TextInput = TextInput.Prose,
  saveLabel: String = "Save",
) {
  val theme = ArgusTheme.colors
  var value by remember { mutableStateOf(initial) }
  val save = {
    val trimmed = value.trim()
    if (trimmed.isNotEmpty()) {
      onDismiss()
      onSave(trimmed)
    }
  }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title, style = ArgusTheme.typography.headline, color = theme.text) },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        message?.let { Text(it, style = ArgusTheme.typography.subheadline, color = theme.textSecondary) }
        ThemedTextField(value, { value = it }, placeholder, input = input, mono = input == TextInput.Code, onSubmit = save)
      }
    },
    confirmButton = { Btn(saveLabel, hugs = true, enabled = value.isNotBlank(), onClick = save) },
    dismissButton = { Btn("Cancel", tone = ButtonTone.Ghost, hugs = true, onClick = onDismiss) },
    containerColor = theme.surface,
  )
}
