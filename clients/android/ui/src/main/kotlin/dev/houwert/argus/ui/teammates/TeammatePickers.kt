package dev.houwert.argus.ui.teammates

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.teammates.TeammateText
import dev.houwert.argus.kit.protocol.generated.TeammateColor
import dev.houwert.argus.kit.protocol.generated.TeammateSymbol
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon as ArgusIcon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.TeammatePalette
import dev.houwert.argus.ui.theme.argusFont

private val SWATCH = 32.dp

/** One swatch per teammate colour; the picked one wears a ring and a check. */
@Composable
fun TeammateColorPicker(selection: TeammateColor, onSelect: (TeammateColor) -> Unit, enabled: Boolean = true) {
  val theme = ArgusTheme.colors
  FlowRow(spacing = 10.dp, rowSpacing = 10.dp, packed = true) {
    for (color in TeammateColor.entries) {
      val picked = color == selection
      val interaction = rememberInteraction()
      Box(
        Modifier.size(SWATCH)
          .border(2.dp, if (picked) theme.text else theme.bg, CircleShape)
          .padding(3.dp)
          .background(TeammatePalette.color(color), CircleShape)
          .argusClickable(interaction, enabled, CircleShape, label = color.rawValue) { onSelect(color) }
          .semantics { selected = picked },
        contentAlignment = Alignment.Center,
      ) {
        if (picked) Icon(ArgusIcon.check, null, Modifier.size(16.dp), tint = Color.White)
      }
    }
  }
}

/** Initials, or one of the symbols, each drawn in the teammate's colour. Null is initials. */
@Composable
fun TeammateSymbolPicker(
  name: String,
  color: TeammateColor,
  selection: TeammateSymbol?,
  onSelect: (TeammateSymbol?) -> Unit,
  enabled: Boolean = true,
) {
  val tint = TeammatePalette.color(color)
  FlowRow(spacing = 10.dp, rowSpacing = 10.dp, packed = true) {
    SymbolCell(selection == null, tint, "Initials", enabled, { onSelect(null) }) {
      Text(TeammateText.initials(name), color = tint, style = argusFont(13, FontWeight.SemiBold))
    }
    for (symbol in TeammateSymbol.entries) {
      SymbolCell(symbol == selection, tint, symbol.rawValue, enabled, { onSelect(symbol) }) {
        Icon(TeammateSymbols.icon(symbol), null, Modifier.size(18.dp), tint = tint)
      }
    }
  }
}

@Composable
private fun SymbolCell(
  picked: Boolean,
  tint: Color,
  label: String,
  enabled: Boolean,
  onClick: () -> Unit,
  content: @Composable () -> Unit,
) {
  val interaction = rememberInteraction()
  Box(
    Modifier.size(40.dp)
      .border(if (picked) 2.dp else 0.dp, if (picked) tint else tint.copy(alpha = 0f), CircleShape)
      .background(tint.copy(alpha = if (picked) 0.22f else 0.1f), CircleShape)
      .argusClickable(interaction, enabled, CircleShape, label = label, onClick = onClick)
      .semantics { selected = picked },
    contentAlignment = Alignment.Center,
  ) { content() }
}


