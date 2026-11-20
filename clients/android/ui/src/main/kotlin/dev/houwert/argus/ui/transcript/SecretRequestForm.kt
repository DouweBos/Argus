package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.util.SecretRequest
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** The card for an agent's `request_secret`: a masked field whose value goes to the host alone, never into the chat. */
@Composable
fun SecretRequestForm(request: SecretRequest, onSubmit: (String) -> Unit, onDecline: () -> Unit, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  // Never saved: a secret mustn't land in saved instance state.
  var value by remember { mutableStateOf("") }
  fun submit() {
    if (value.isEmpty()) return
    val sent = value
    value = ""
    onSubmit(sent)
  }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icon.lock, null, Modifier.size(13.dp), tint = theme.textMuted)
      Text(request.label, color = theme.text, style = argusFont(13, FontWeight.SemiBold))
    }
    if (request.reason.isNotEmpty()) Text(request.reason, color = theme.textSecondary, style = argusFont(13))
    ThemedTextField(value, { value = it }, request.label, mono = true, input = TextInput.Code, secure = true, onSubmit = ::submit)
    MutedText("${request.destination} It never appears in the chat.")
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Btn("Send securely", Modifier.weight(1f), small = true, fills = true, enabled = value.isNotEmpty(), onClick = ::submit)
      Btn("Decline", Modifier.weight(1f), tone = ButtonTone.Secondary, small = true, fills = true, onClick = onDecline)
    }
  }
}
