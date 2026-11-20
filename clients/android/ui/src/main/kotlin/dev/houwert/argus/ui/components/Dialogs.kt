package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A yes/no question before something that can't be undone (`.alert` with a destructive button). */
@Composable
fun ConfirmDialog(
  title: String,
  confirmLabel: String,
  onConfirm: () -> Unit,
  onDismiss: () -> Unit,
  message: String? = null,
  destructive: Boolean = false,
) {
  val theme = ArgusTheme.colors
  AlertDialog(
    onDismissRequest = onDismiss,
    containerColor = theme.surface,
    title = { Text(title, color = theme.text, style = argusFont(18, FontWeight.SemiBold)) },
    text = message?.let { { Text(it, color = theme.textSecondary, style = argusFont(14)) } },
    confirmButton = {
      Btn(confirmLabel, tone = if (destructive) ButtonTone.Danger else ButtonTone.Primary, small = true, hugs = true) {
        onDismiss()
        onConfirm()
      }
    },
    dismissButton = { Btn("Cancel", tone = ButtonTone.Ghost, small = true, hugs = true, onClick = onDismiss) },
  )
}

/** A dialog asking for one line of text, like a rename. */
@Composable
fun TextPromptDialog(
  title: String,
  initial: String,
  confirmLabel: String,
  onConfirm: (String) -> Unit,
  onDismiss: () -> Unit,
  placeholder: String = "Name",
) {
  val theme = ArgusTheme.colors
  var value by remember { mutableStateOf(initial) }
  val submit = {
    onDismiss()
    onConfirm(value)
  }
  AlertDialog(
    onDismissRequest = onDismiss,
    containerColor = theme.surface,
    title = { Text(title, color = theme.text, style = argusFont(18, FontWeight.SemiBold)) },
    text = { ThemedTextField(value, { value = it }, placeholder, input = TextInput.Name, onSubmit = submit) },
    confirmButton = { Btn(confirmLabel, small = true, hugs = true, enabled = value.isNotBlank(), onClick = submit) },
    dismissButton = { Btn("Cancel", tone = ButtonTone.Ghost, small = true, hugs = true, onClick = onDismiss) },
  )
}

/** One entry in an [OverflowMenu]. */
data class MenuAction(val label: String, val icon: ImageVector? = null, val destructive: Boolean = false, val onClick: () -> Unit)

/** A row's trailing "more" button opening its actions (the iOS ellipsis menu). */
@Composable
fun OverflowMenu(label: String, actions: List<MenuAction>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  var open by remember { mutableStateOf(false) }
  Box(modifier) {
    IconBtn(ArgusIcon.ellipsis, label, size = 18.dp) { open = true }
    DropdownMenu(open, { open = false }, containerColor = theme.surface) {
      for (action in actions) {
        val tint = if (action.destructive) theme.error else theme.text
        DropdownMenuItem(
          text = { Text(action.label, color = tint, style = argusFont(15)) },
          leadingIcon = action.icon?.let { { Icon(it, null, Modifier.size(18.dp), tint = tint) } },
          onClick = {
            open = false
            action.onClick()
          },
        )
      }
    }
  }
}

/** A 6-digit check code, large and split in two halves, as every device prints it. */
@Composable
fun CheckCodeCard(code: String, modifier: Modifier = Modifier) {
  Card(modifier) {
    Text(
      CheckCode.grouped(code),
      Modifier.fillMaxWidth().semantics { contentDescription = "Check code $code" },
      color = ArgusTheme.colors.text, style = argusFont(30, FontWeight.SemiBold, mono = true).copy(letterSpacing = argusFont(30).fontSize * 0.13f),
      textAlign = TextAlign.Center,
    )
  }
}

object CheckCode {
  /** `482 093`: a six-digit code read as two halves. */
  fun grouped(code: String): String = if (code.length == 6) "${code.take(3)} ${code.takeLast(3)}" else code
}

