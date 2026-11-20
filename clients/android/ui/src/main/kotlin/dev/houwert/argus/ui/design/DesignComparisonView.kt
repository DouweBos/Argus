package dev.houwert.argus.ui.design

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.crypto.ArgusBase64
import dev.houwert.argus.kit.protocol.generated.DesignComparison
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** The frame next to a device screenshot at the same pixel size, one at a time: the design, the screen, or where they differ. */
@Composable
fun DesignComparisonView(
  comparison: DesignComparison,
  percent: Int,
  deviceName: String?,
  onClose: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  var pane by rememberSaveable { mutableStateOf(DesignComparisonPane.Diff) }
  // A component frame the host couldn't find on the screenshot; its diff means nothing.
  val notOnScreen = comparison.match?.found == false
  val tone = DesignComparisonText.tone(percent, notOnScreen)
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(if (notOnScreen) "Not on screen" else "$percent% of pixels differ", color = tone.color(theme), style = argusFont(15, FontWeight.SemiBold))
        when {
          notOnScreen -> MutedText("Scroll the component into view, then compare again.", maxLines = 2)
          deviceName != null -> MutedText("Against $deviceName", maxLines = 1)
        }
      }
      IconBtn(Icon.close, "Close compare", size = 18.dp, onClick = onClose)
    }
    SegmentedControl(pane, listOf(DesignComparisonPane.Design to "Design", DesignComparisonPane.Screen to "Screen", DesignComparisonPane.Diff to "Diff")) { pane = it }
    val image = when (pane) {
      DesignComparisonPane.Design -> comparison.design
      DesignComparisonPane.Screen -> comparison.screenshot
      DesignComparisonPane.Diff -> comparison.diff
    }
    val bytes = remember(image) { ArgusBase64.decode(image) }
    ZoomPanImage(
      bytes, pane.label,
      Modifier.fillMaxWidth()
        .aspectRatio((maxOf(comparison.width, 1.0) / maxOf(comparison.height, 1.0)).toFloat())
        .heightIn(max = 640.dp)
        .clip(RoundedCornerShape(ArgusMetrics.radiusSmall)),
    )
  }
}

enum class DesignComparisonPane(val label: String) {
  Design("The design"),
  Screen("The device's screen"),
  Diff("Differences in red over the screen"),
}

object DesignComparisonText {
  /** Under 2% reads as a match, as the agents' compare tool treats it. */
  fun tone(percent: Int, notOnScreen: Boolean): Tone = when {
    notOnScreen -> Tone.Warning
    percent < 2 -> Tone.Success
    percent < 10 -> Tone.Warning
    else -> Tone.Danger
  }
}
