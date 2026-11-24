package dev.houwert.argus.ui.teammates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteTeammateTemplate
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** A starting teammate: who it is and the duties it comes with; [missing] names what the computer hasn't connected. */
@Composable
fun TeammateTemplateCard(
  template: RemoteTeammateTemplate,
  missing: List<String>,
  modifier: Modifier = Modifier,
  onClick: (() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  Card(modifier, onClick = onClick) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
      TeammateAvatar(template.name, template.color, template.avatar, size = 40.dp)
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(
            template.name, Modifier.weight(1f), color = theme.text, style = argusFont(16, FontWeight.SemiBold),
            maxLines = 1, overflow = TextOverflow.Ellipsis,
          )
          if (missing.isNotEmpty()) Badge("Needs ${missing.joinToString(", ")}", tone = Tone.Warning)
        }
        if (template.tagline.isNotEmpty()) MutedText(template.tagline)
        if (template.dutyNames.isNotEmpty()) {
          FlowRow(Modifier.padding(top = 2.dp), spacing = 6.dp, rowSpacing = 6.dp, packed = true) {
            for (duty in template.dutyNames) Badge(duty)
          }
        }
      }
    }
  }
}
