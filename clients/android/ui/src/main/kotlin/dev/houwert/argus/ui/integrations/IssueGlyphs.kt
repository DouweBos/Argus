package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.LinearIssueBoard
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * The circle Linear draws for a status: dashed, empty, half, checked or crossed — Peacock's
 * `IssueStatusIcon`. Unknown types draw as unstarted. Tinted with the state's own colour when it has one.
 */
@Composable
fun IssueStatusGlyph(type: String, modifier: Modifier = Modifier, color: String? = null, size: Dp = 14.dp) {
  val theme = ArgusTheme.colors
  val tint = linearColor(color) ?: when (type) {
    "triage" -> theme.error
    "started" -> theme.warning
    "completed" -> theme.success
    else -> theme.textMuted
  }
  val mark = theme.bg
  Canvas(modifier.size(size).clearAndSetSemantics {}) {
    val unit = this.size.width / 14f
    val ringTopLeft = Offset(1.5f * unit, 1.5f * unit)
    val ringSize = Size(11f * unit, 11f * unit)
    val line = 1.5f * unit
    when (type) {
      "backlog" ->
        drawOval(tint, ringTopLeft, ringSize, style = Stroke(line, pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f * unit, 1.6f * unit))))
      "started" -> {
        drawOval(tint, ringTopLeft, ringSize, style = Stroke(line))
        drawArc(tint, -90f, 180f, useCenter = true, topLeft = Offset(3.5f * unit, 3.5f * unit), size = Size(7f * unit, 7f * unit))
      }
      "completed", "canceled" -> {
        drawOval(tint, Offset(0.75f * unit, 0.75f * unit), Size(12.5f * unit, 12.5f * unit))
        val stroke = Stroke(line, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val path = Path()
        if (type == "completed") {
          path.moveTo(4.4f * unit, 7.1f * unit)
          path.lineTo(6.2f * unit, 8.9f * unit)
          path.lineTo(9.7f * unit, 5.3f * unit)
        } else {
          path.moveTo(5f * unit, 5f * unit)
          path.lineTo(9f * unit, 9f * unit)
          path.moveTo(9f * unit, 5f * unit)
          path.lineTo(5f * unit, 9f * unit)
        }
        drawPath(path, mark, style = stroke)
      }
      else -> drawOval(tint, ringTopLeft, ringSize, style = Stroke(line))
    }
  }
}

/** Signal bars for high to low, a filled alert for urgent, dashes for none — Peacock's `PriorityIcon`. */
@Composable
fun PriorityGlyph(priority: Int, modifier: Modifier = Modifier, size: Dp = 14.dp) {
  val theme = ArgusTheme.colors
  val label = LinearIssueBoard.priorityLabel(priority)
  Canvas(modifier.size(size).clearAndSetSemantics { contentDescription = label }) {
    val unit = this.size.width / 14f
    when (priority) {
      1 -> {
        drawRoundRect(theme.error, Offset(unit, unit), Size(12f * unit, 12f * unit), CornerRadius(3f * unit))
        val stroke = 1.7f * unit
        drawLine(theme.bg, Offset(7f * unit, 3.8f * unit), Offset(7f * unit, 7.8f * unit), stroke, StrokeCap.Round)
        drawLine(theme.bg, Offset(7f * unit, 10.2f * unit), Offset(7f * unit, 10.21f * unit), stroke, StrokeCap.Round)
      }
      in 2..4 -> {
        // High lights all three bars, medium two, low one.
        val lit = 5 - priority
        for (bar in 0 until 3) {
          val height = 4f + bar * 3
          val rect = Rect(Offset((1.5f + bar * 4) * unit, (11f - bar * 3) * unit), Size(3f * unit, height * unit))
          val tone = theme.textSecondary.copy(alpha = theme.textSecondary.alpha * if (bar < lit) 1f else 0.3f)
          drawRoundRect(tone, rect.topLeft, rect.size, CornerRadius(unit))
        }
      }
      else -> for (x in listOf(2f, 6f, 10f)) {
        drawRoundRect(theme.textSecondary, Offset(x * unit, 6.25f * unit), Size(2.5f * unit, 1.5f * unit), CornerRadius(0.75f * unit))
      }
    }
  }
}

@Composable
fun PriorityGlyph(priority: Double, modifier: Modifier = Modifier, size: Dp = 14.dp) = PriorityGlyph(priority.toInt(), modifier, size)

/** A colour Linear sends as `#rrggbb` (a state's or a label's): data, not a theme colour. */
fun linearColor(hex: String?): Color? {
  val digits = hex?.trim()?.removePrefix("#") ?: return null
  val value = digits.toLongOrNull(16) ?: return null
  return when (digits.length) {
    6 -> Color(0xFF000000 or value)
    8 -> Color(((value and 0xFF) shl 24) or (value ushr 8))
    else -> null
  }
}
