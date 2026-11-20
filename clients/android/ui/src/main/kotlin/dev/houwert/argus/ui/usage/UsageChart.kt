package dev.houwert.argus.ui.usage

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.usage.UsageMetric
import dev.houwert.argus.core.usage.UsageRunnerPoint
import dev.houwert.argus.core.usage.UsageSummaryFormat
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummaryBucket
import dev.houwert.argus.kit.protocol.generated.UsageSeriesPoint
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow

/** Axis arithmetic for the usage charts, kept pure so it can be tested. */
object UsageChartMath {
  /** Round gridline values from 0 past [max]: steps of 1, 2, 2.5 or 5 times a power of ten, about [count] of them. */
  fun ticks(max: Double, count: Int = 3): List<Double> {
    if (max <= 0 || !max.isFinite()) return listOf(0.0, 1.0)
    val raw = max / count
    val magnitude = 10.0.pow(floor(log10(raw)))
    val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).first { it * magnitude >= raw } * magnitude
    val top = ceil(max / step).toInt()
    return (0..top).map { it * step }
  }

  /** Which of [count] buckets get a date under them: at most [max], evenly spaced from the first. */
  fun labelIndices(count: Int, max: Int = 5): List<Int> {
    if (count <= 0) return emptyList()
    val stride = ceil(count / max.toDouble()).toInt().coerceAtLeast(1)
    return (0 until count step stride).toList()
  }
}

/** One series as an accent area: the whole summary, or one model's trend. */
@Composable
fun UsageAreaChart(series: List<UsageSeriesPoint>, bucket: ClaudeUsageSummaryBucket, metric: UsageMetric, modifier: Modifier = Modifier, height: Dp = 160.dp) {
  val theme = ArgusTheme.colors
  val values = series.map { UsageSummaryFormat.seriesValue(it, metric) }
  ChartFrame(series.map { it.start }, values, bucket, metric, modifier.height(height)) { plot ->
    val points = values.mapIndexed { i, v -> plot.at(i, v) }
    val line = smoothPath(points)
    val area = Path().apply {
      addPath(line)
      lineTo(points.last().x, plot.bottom)
      lineTo(points.first().x, plot.bottom)
      close()
    }
    drawPath(area, Brush.verticalGradient(listOf(theme.accent.copy(alpha = 0.35f), theme.accent.copy(alpha = 0.02f)), plot.top, plot.bottom))
    drawPath(line, theme.accent, style = Stroke(2.dp.toPx()))
  }
}

/** Several runners stacked, one chart-palette hue each, with a legend. */
@Composable
fun UsageStackedChart(
  points: List<UsageRunnerPoint>,
  labels: List<String>,
  bucket: ClaudeUsageSummaryBucket,
  metric: UsageMetric,
  modifier: Modifier = Modifier,
  height: Dp = 160.dp,
) {
  val theme = ArgusTheme.colors
  val palette = theme.chartSeries
  val starts = points.map { it.start }.distinct().sorted()
  val bySeries = labels.map { label -> starts.map { s -> points.firstOrNull { it.series == label && it.start == s }?.value ?: 0.0 } }
  val totals = starts.indices.map { i -> bySeries.sumOf { it[i] } }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
    ChartFrame(starts, totals, bucket, metric, Modifier.height(height)) { plot ->
      val below = DoubleArray(starts.size)
      bySeries.forEachIndexed { index, values ->
        val lower = starts.indices.map { plot.at(it, below[it]) }
        val upper = starts.indices.map { plot.at(it, below[it] + values[it]) }
        val path = smoothPath(upper).apply {
          appendSmooth(lower.reversed(), join = true)
          close()
        }
        drawPath(path, palette[index % palette.size].copy(alpha = 0.85f))
        values.forEachIndexed { i, v -> below[i] += v }
      }
    }
    FlowRow(spacing = 14.dp, rowSpacing = 6.dp, packed = true) {
      labels.forEachIndexed { index, label ->
        Row(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
          Box(Modifier.size(8.dp).background(palette[index % palette.size], CircleShape))
          Text(label, color = theme.textSecondary, style = argusFont(12))
        }
      }
    }
  }
}

/** Where values land on the canvas once the axes have taken their room. */
private class Plot(val left: Float, val top: Float, val right: Float, val bottom: Float, val count: Int, val max: Double) {
  fun at(index: Int, value: Double): Offset {
    val x = if (count <= 1) (left + right) / 2 else left + (right - left) * index / (count - 1)
    return Offset(x, bottom - ((value / max).toFloat() * (bottom - top)))
  }
}

@Composable
private fun ChartFrame(
  starts: List<Double>,
  values: List<Double>,
  bucket: ClaudeUsageSummaryBucket,
  metric: UsageMetric,
  modifier: Modifier,
  draw: DrawScope.(Plot) -> Unit,
) {
  val theme = ArgusTheme.colors
  val measurer = rememberTextMeasurer()
  val labelStyle = argusFont(10).copy(color = theme.textMuted)
  val grid = theme.borderSubtle
  val ticks = UsageChartMath.ticks(values.maxOrNull() ?: 0.0)
  val format = DateTimeFormatter.ofPattern(if (bucket == ClaudeUsageSummaryBucket.hour) "h a" else "MMM d")
  val dates = starts.map { Instant.ofEpochMilli(it.toLong()).atZone(ZoneId.systemDefault()).format(format) }
  Canvas(modifier.fillMaxWidth().semantics { contentDescription = "Usage over time" }) {
    if (starts.isEmpty()) return@Canvas
    val yLabels = ticks.map { measurer.measure(metric.format(it), labelStyle) }
    val yWidth = yLabels.maxOf { it.size.width } + 6.dp.toPx()
    val xHeight = measurer.measure("Ag", labelStyle).size.height + 4.dp.toPx()
    val top = yLabels.first().size.height / 2f
    val plot = Plot(0f, top, size.width - yWidth, size.height - xHeight, starts.size, ticks.last())
    ticks.forEachIndexed { i, tick ->
      val y = plot.at(0, tick).y
      drawLine(grid, Offset(plot.left, y), Offset(plot.right, y), 1.dp.toPx())
      drawText(yLabels[i], topLeft = Offset(plot.right + 6.dp.toPx(), y - yLabels[i].size.height / 2f))
    }
    for (i in UsageChartMath.labelIndices(starts.size)) {
      val x = plot.at(i, 0.0).x
      drawLine(grid, Offset(x, plot.top), Offset(x, plot.bottom), 1.dp.toPx())
      drawXLabel(measurer, dates[i], labelStyle, x, plot)
    }
    draw(plot)
  }
}

private fun DrawScope.drawXLabel(measurer: TextMeasurer, text: String, style: androidx.compose.ui.text.TextStyle, x: Float, plot: Plot) {
  val layout = measurer.measure(text, style)
  val left = (x - layout.size.width / 2f).coerceIn(0f, size.width - layout.size.width)
  drawText(layout, topLeft = Offset(left, plot.bottom + 4.dp.toPx()))
}

/** A curve through the points with flat tangents at each, so it never overshoots a bucket. */
private fun smoothPath(points: List<Offset>): Path = Path().apply { appendSmooth(points, join = false) }

/** Continues the path through [points]; [join] draws a straight line to the first rather than starting anew. */
private fun Path.appendSmooth(points: List<Offset>, join: Boolean) {
  if (points.isEmpty()) return
  if (join) lineTo(points.first().x, points.first().y) else moveTo(points.first().x, points.first().y)
  for (i in 1 until points.size) {
    val a = points[i - 1]
    val b = points[i]
    val mid = (a.x + b.x) / 2
    cubicTo(mid, a.y, mid, b.y, b.x, b.y)
  }
}
