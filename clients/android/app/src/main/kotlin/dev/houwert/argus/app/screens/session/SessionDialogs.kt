package dev.houwert.argus.app.screens.session

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import dev.houwert.argus.ui.theme.ArgusTheme

/** Why something the user asked for didn't happen, with only an OK, as the iPhone's alerts. */
@Composable
fun NoticeDialog(title: String, message: String, onDismiss: () -> Unit) {
  val theme = ArgusTheme.colors
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title, color = theme.text) },
    text = { Text(message, color = theme.textSecondary) },
    confirmButton = { TextButton(onDismiss) { Text("OK", color = theme.accent) } },
    containerColor = theme.bgSecondary,
  )
}
