package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.transcript.label
import dev.houwert.argus.kit.protocol.generated.RemoteMessageCommand
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A runner slash command at the head of its message, set apart from the text as a pill. */
@Composable
fun CommandChip(command: RemoteMessageCommand, modifier: Modifier = Modifier, size: Int = 12) {
  val theme = ArgusTheme.colors
  Row(
    modifier
      .clearAndSetSemantics { contentDescription = "Command ${command.label}" }
      .background(theme.bg, CircleShape)
      .border(1.dp, theme.accentBorder, CircleShape)
      .padding(horizontal = 8.dp, vertical = 3.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(Icon.slashCommand, null, Modifier.size((size + 1).dp), tint = theme.accent)
    Text(command.label, color = theme.accent, style = argusFont(size, FontWeight.SemiBold, mono = true), maxLines = 1)
  }
}
