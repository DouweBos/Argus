package dev.houwert.argus.ui.automations

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.automations.ReportBlockView
import dev.houwert.argus.core.automations.ReportCell
import dev.houwert.argus.core.automations.ReportStatItem
import dev.houwert.argus.core.automations.formatReportNumber
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlin.math.max

/**
 * A run's structured report. [proposals] renders the proposals block's cards by id: the app
 * owns them and their actions.
 */
@Composable
fun ReportBlocksView(
  blocks: List<ReportBlockView>,
  modifier: Modifier = Modifier,
  proposals: @Composable (List<String>) -> Unit,
) {
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    for (block in blocks) Block(block, proposals)
  }
}

@Composable
private fun Block(block: ReportBlockView, proposals: @Composable (List<String>) -> Unit) {
  val theme = ArgusTheme.colors
  when (block) {
    is ReportBlockView.Heading -> Text(block.text, color = theme.text, style = argusFont(16, FontWeight.Bold))
    is ReportBlockView.Markdown -> ReportMarkdown(block.text)
    is ReportBlockView.Stats -> StatsGrid(block.items)
    is ReportBlockView.Table -> ReportTable(block.columns, block.rows)
    is ReportBlockView.ListItems ->
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val uri = LocalUriHandler.current
        for (item in block.items) {
          val interaction = rememberInteraction()
          val href = item.href
          Row(
            Modifier.fillMaxWidth()
              .then(if (href != null) Modifier.argusClickable(interaction, label = "Open link", shape = RoundedCornerShape(4.dp)) { runCatching { uri.openUri(href) } } else Modifier),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            Box(Modifier.padding(top = 7.dp).size(5.dp).background(AutomationText.reportTone(item.tone).color(theme), CircleShape))
            Text(item.text, Modifier.weight(1f), color = if (href != null) theme.accent else theme.text, style = argusFont(14))
          }
        }
      }
    is ReportBlockView.Series -> Series(block.labels, block.values, block.label)
    is ReportBlockView.Proposals ->
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
          if (block.ids.size == 1) "Proposal" else "${block.ids.size} proposals",
          color = theme.textSecondary, style = argusFont(13, FontWeight.SemiBold),
        )
        proposals(block.ids)
      }
    // A session id isn't an agent id, so there is nothing honest to open.
    is ReportBlockView.Sessions -> MutedText("${AutomationText.plural(block.ids.size, "session")} touched")
  }
}

@Composable
private fun StatsGrid(items: List<ReportStatItem>) {
  val theme = ArgusTheme.colors
  BoxWithConstraints(Modifier.fillMaxWidth()) {
    val gap = 8.dp
    val columns = max(1, ((maxWidth + gap) / (120.dp + gap)).toInt())
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
      for (row in items.chunked(columns)) {
        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
          for (item in row) {
            Column(
              Modifier.weight(1f).background(theme.bgTertiary, RoundedCornerShape(ArgusMetrics.radiusSmall)).padding(10.dp),
              verticalArrangement = Arrangement.spacedBy(3.dp),
            ) {
              Text(item.label, color = theme.textMuted, style = argusFont(11), maxLines = 1, overflow = TextOverflow.Ellipsis)
              Text(item.value, color = theme.text, style = argusFont(18, FontWeight.SemiBold))
              val delta = item.delta
              if (delta != null && delta != 0.0) {
                Text(
                  if (delta > 0) "+${formatReportNumber(delta)}" else formatReportNumber(delta),
                  color = if (delta > 0) theme.success else theme.error, style = argusFont(11, FontWeight.SemiBold),
                )
              }
            }
          }
          // Keeps the last row's cells the same width as the rows above.
          repeat(columns - row.size) { Box(Modifier.weight(1f)) }
        }
      }
    }
  }
}

@Composable
private fun ReportTable(columns: List<String>, rows: List<List<ReportCell>>) {
  val theme = ArgusTheme.colors
  Column(
    Modifier.fillMaxWidth().background(theme.bgTertiary, RoundedCornerShape(ArgusMetrics.radiusSmall))
      .horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
  ) {
    Row {
      for (c in columns) Text(c, Modifier.width(130.dp).padding(vertical = 6.dp), color = theme.textMuted, style = argusFont(11, FontWeight.Bold))
    }
    if (rows.isEmpty()) MutedText("No rows.", Modifier.padding(vertical = 6.dp))
    for (row in rows) {
      Row {
        for (cell in row) Text(cell.text, Modifier.width(130.dp).padding(vertical = 5.dp), color = theme.text, style = argusFont(13))
      }
    }
  }
}

@Composable
private fun Series(labels: List<String>, values: List<Double>, label: String?) {
  val theme = ArgusTheme.colors
  val peak = max(values.maxOrNull() ?: 1.0, 1.0)
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    if (label != null) MutedText(label)
    for ((name, value) in labels.zip(values)) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(name, Modifier.width(64.dp), color = theme.textMuted, style = argusFont(11), maxLines = 1, overflow = TextOverflow.Ellipsis)
        BoxWithConstraints(Modifier.weight(1f).height(10.dp)) {
          val width = maxOf(2.dp, maxWidth * (value / peak).toFloat())
          Box(Modifier.width(width).height(10.dp).background(theme.accent, RoundedCornerShape(3.dp)))
        }
        Text(
          formatReportNumber(value), Modifier.width(48.dp), color = theme.textSecondary, style = argusFont(11, mono = true),
          textAlign = TextAlign.End,
        )
      }
    }
  }
}
