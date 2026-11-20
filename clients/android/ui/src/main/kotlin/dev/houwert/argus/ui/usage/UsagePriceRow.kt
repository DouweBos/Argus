package dev.houwert.argus.ui.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.usage.UsagePriceDraft
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.TextKeyboard
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** One model: its four rates and a mapping, with Reset to automatic, as a card of fields. */
@Composable
fun UsagePriceRowEditor(row: UsagePriceDraft.Row, canEdit: Boolean, onChange: (UsagePriceDraft.Row) -> Unit, onReset: () -> Unit) {
  val theme = ArgusTheme.colors
  val editable = canEdit && !row.resetting
  Column(Modifier.alpha(if (row.resetting) 0.6f else 1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      SelectionContainer(Modifier.weight(1f, fill = false)) {
        Text(row.model, color = theme.text, style = argusFont(13, FontWeight.SemiBold, mono = true), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
      }
      Badge(status(row), tone = if (row.resetting) Tone.Warning else if (row.isSet) Tone.Accent else Tone.Muted)
    }
    val rates = listOf(
      Rate("Input", row.input, row.list?.input, "Required") { row.copy(input = it) },
      Rate("Output", row.output, row.list?.output, "Required") { row.copy(output = it) },
      Rate("Cache read", row.cacheRead, row.list?.cacheRead, "Input rate") { row.copy(cacheRead = it) },
      Rate("Cache write", row.cacheWrite, row.list?.cacheWrite, "Input rate") { row.copy(cacheWrite = it) },
    )
    AdaptiveGrid(rates, minWidth = 120.dp, spacing = 8.dp) { rate ->
      // A mapped model's rates don't apply, so they're off.
      Labelled(rate.label, Modifier.alpha(if (row.isMapped) 0.5f else 1f)) {
        ThemedTextField(
          rate.value, { onChange(rate.set(it)) }, rate.list?.let { "$" + UsagePriceDraft.text(it) } ?: rate.fallback,
          keyboard = TextKeyboard.DecimalPad, input = TextInput.Code, enabled = editable && !row.isMapped,
        )
      }
    }
    Labelled("Map to") {
      ThemedTextField(row.mapTo, { onChange(row.copy(mapTo = it)) }, "Count as another model", mono = true, input = TextInput.Code, enabled = editable)
    }
    // Below the fields: beside the name it wraps on a phone.
    if (canEdit && (row.isSet || row.resetting)) {
      Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Btn(
          if (row.resetting) "Undo" else "Reset to automatic", tone = ButtonTone.Ghost, small = true, hugs = true,
          icon = if (row.resetting) Icon.undo else null, onClick = onReset,
        )
      }
    }
  }
}

private class Rate(val label: String, val value: String, val list: Double?, val fallback: String, val set: (String) -> UsagePriceDraft.Row)

private fun status(row: UsagePriceDraft.Row): String = when {
  row.resetting -> "Resets to automatic"
  row.isMapped -> "Mapped"
  row.isSet -> "Custom"
  row.list == null -> "No price"
  else -> "List price"
}

@Composable
private fun Labelled(label: String, modifier: Modifier = Modifier, field: @Composable () -> Unit) {
  Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(label, color = ArgusTheme.colors.textMuted, style = argusFont(11, FontWeight.Medium))
    field()
  }
}
