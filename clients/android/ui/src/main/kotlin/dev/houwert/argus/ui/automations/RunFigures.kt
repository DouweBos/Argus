package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.AutomationCalibration
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.roundToInt

/** A run's figures (when, how long, what it cost), wrapping onto a second line on a narrow phone. */
@Composable
fun RunFigures(figures: List<Pair<String, String>>, modifier: Modifier = Modifier) {
  FlowRow(modifier.fillMaxWidth(), spacing = 28.dp, rowSpacing = 12.dp, packed = true) {
    for ((label, value) in figures) Figure(label, value)
  }
}

@Composable
private fun Figure(label: String, value: String, delta: String? = null, poor: Boolean = false) {
  val theme = ArgusTheme.colors
  Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Text(label, color = theme.textMuted, style = ArgusTheme.typography.caption)
    SelectionContainer { Text(value, color = theme.text, style = argusFont(20, FontWeight.SemiBold)) }
    if (delta != null) Text(delta, color = if (poor) theme.error else theme.textSecondary, style = ArgusTheme.typography.caption)
  }
}

/**
 * An automation's track record, stated plainly: one that is wrong seven times out of ten
 * should read as wrong.
 */
@Composable
fun CalibrationStats(calibration: AutomationCalibration, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val c = calibration
  val rate = c.acceptanceRate
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    // Four across where they fit, two by two on a narrow phone.
    FlowRow(Modifier.fillMaxWidth(), spacing = 24.dp, rowSpacing = 12.dp, packed = true) {
      Figure(
        "Acceptance", rate?.let { "${(it * 100).roundToInt()}%" } ?: "None yet",
        "${(c.accepted + c.autoStarted + c.resolved).toInt()} kept · ${c.dismissed.toInt()} dismissed",
        poor = (rate ?: 1.0) < 0.5,
      )
      Figure("Auto-started", "${c.autoStarted.toInt()}")
      Figure("Waiting", "${c.pending.toInt()}")
      Figure("Merged", "${c.merged.toInt()}", "${c.abandoned.toInt()} abandoned")
    }
    for (dismissal in c.dismissals) {
      Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
        Icon(Icon.warning, null, tint = theme.warning, modifier = Modifier.padding(top = 1.dp).size(15.dp))
        Text("${dismissal.title}: ${dismissal.reason}", color = theme.warning, style = argusFont(13))
      }
    }
  }
}
