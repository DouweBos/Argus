package dev.houwert.argus.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.min

/**
 * Lays controls out left to right, wrapping when the next one would not fit. Items in a row share
 * its width equally, so a row of two reads as two columns rather than two differently-sized
 * buttons; a plain Row squeezes labels until they wrap mid-word. `packed` is for badges and chips:
 * each keeps its own width from the leading edge.
 */
@Composable
fun FlowRow(
  modifier: Modifier = Modifier,
  spacing: Dp = 8.dp,
  rowSpacing: Dp = 8.dp,
  packed: Boolean = false,
  content: @Composable () -> Unit,
) {
  Layout(content, modifier) { measurables, constraints ->
    val width = if (constraints.hasBoundedWidth) constraints.maxWidth else constraints.minWidth.coerceAtLeast(1)
    val gap = spacing.roundToPx()
    val ideals = measurables.map { it.maxIntrinsicWidth(Constraints.Infinity) }
    val rows = FlowRowMath.rows(ideals, width, gap)
    val placed =
      rows.map { row ->
        val cells = FlowRowMath.cellWidths(row.map { ideals[it] }, width, gap, packed)
        row.zip(cells).map { (i, cell) ->
          val p = measurables[i].measure(Constraints(maxWidth = max(cell, 0)))
          Triple(p, cell, row)
        }
      }
    val heights = placed.map { row -> row.maxOfOrNull { it.first.height } ?: 0 }
    val total = heights.sum() + rowSpacing.roundToPx() * max(0, rows.size - 1)
    layout(width, total) {
      var y = 0
      placed.forEachIndexed { r, row ->
        var x = 0
        for ((p, cell) in row) {
          // Centred in its cell: a control that declines to fill it should still sit on the column.
          val dx = if (packed) 0 else (cell - p.width) / 2
          p.placeRelative(x + dx, y + (heights[r] - p.height) / 2)
          x += cell + gap
        }
        y += heights[r] + rowSpacing.roundToPx()
      }
    }
  }
}

/** FlowRow's arithmetic, apart from Compose so it can be tested. */
object FlowRowMath {
  /**
   * Equal columns, unless one would truncate a wider label the row has room for; then each gets
   * its ideal width plus an equal share of the rest. Packed, each just gets its ideal width.
   */
  fun cellWidths(ideals: List<Int>, width: Int, spacing: Int, packed: Boolean): List<Int> {
    val available = width - spacing * (ideals.size - 1)
    if (packed) return ideals.map { min(it, available) }
    val equal = available / ideals.size
    if (ideals.none { it > equal }) return ideals.map { equal }
    val spare = max(0, available - ideals.sum()) / ideals.size
    return ideals.map { min(it + spare, available) }
  }

  /** Greedy packing on each item's ideal width. */
  fun rows(ideals: List<Int>, width: Int, spacing: Int): List<List<Int>> {
    val rows = mutableListOf<List<Int>>()
    var current = mutableListOf<Int>()
    var used = 0
    ideals.forEachIndexed { i, ideal ->
      val needed = if (current.isEmpty()) ideal else used + spacing + ideal
      if (current.isNotEmpty() && needed > width) {
        rows += current
        current = mutableListOf(i)
        used = ideal
      } else {
        current += i
        used = needed
      }
    }
    if (current.isNotEmpty()) rows += current
    return rows
  }
}
