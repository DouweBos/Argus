package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * The memories an owner (an automation or a teammate) keeps: one card each, opening [open], and
 * with control an Add button that opens it with null.
 */
@Composable
fun MemoriesSection(
  items: List<RemoteAutomationMemory>,
  hasControl: Boolean,
  emptyMessage: String,
  showsHeader: Boolean = true,
  open: (RemoteAutomationMemory?) -> Unit,
) {
  val theme = ArgusTheme.colors
  if (showsHeader) SectionHeader("Memories", count = items.size)
  if (items.isEmpty()) MutedText(emptyMessage)
  for (memory in items) {
    Card(onClick = { open(memory) }) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(
          memory.name, Modifier.weight(1f), color = theme.text, style = argusFont(13, FontWeight.SemiBold, mono = true),
          maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        Badge(memory.type.rawValue)
      }
      MutedText(memory.description, maxLines = 2)
    }
  }
  if (hasControl) Btn("Add memory", tone = ButtonTone.Secondary, small = true, icon = Icon.plus) { open(null) }
}
