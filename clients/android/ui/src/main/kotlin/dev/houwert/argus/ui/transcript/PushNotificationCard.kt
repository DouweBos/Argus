package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/** A notification the agent sent to your devices, shown as what it is: its title and message, never the raw result. */
@Composable
internal fun PushNotificationCard(call: RemoteToolCall) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val title = call.input["title"].stringValue?.ifEmpty { null }
  val body = call.input["body"].stringValue?.ifEmpty { null }
  Column(
    Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}
      .clip(shape).background(theme.accentSoft).border(1.dp, theme.accentBorder, shape).padding(11.dp),
    verticalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icon.notification, null, Modifier.size(12.dp), tint = theme.accent)
      Text("Notification", color = theme.accent, style = argusFont(11, FontWeight.SemiBold))
      Spacer(Modifier.weight(1f))
      if (undelivered(call)) Badge("not delivered", tone = Tone.Danger)
      if (call.isError == true) Badge("error", tone = Tone.Danger)
    }
    if (title != null) Text(title, color = theme.text, style = argusFont(15, FontWeight.SemiBold))
    if (body != null) MarkdownView(body, baseSize = 14)
  }
}

/** The tool answers `{"delivered": bool}`; anything else isn't a failure. */
internal fun undelivered(call: RemoteToolCall): Boolean {
  val text = call.resultBlocks.filterIsInstance<RemoteToolResultBlock.Text>().joinToString("") { it.value.text }
  val parsed = runCatching { Json.parseToJsonElement(text) as? JsonObject }.getOrNull() ?: return false
  return parsed["delivered"]?.jsonPrimitive?.booleanOrNull == false
}
