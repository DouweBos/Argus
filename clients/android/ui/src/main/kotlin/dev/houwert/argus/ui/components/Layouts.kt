package dev.houwert.argus.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlin.math.max
import kotlin.math.min
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** The one column a chat reads in, centred on the canvas and clear of anything floating at its trailing edge. */
object ReadingColumn {
  /** The text's width at most. */
  const val MAX_WIDTH = 700f
  /** Kept clear at the pane's edges. */
  const val GUTTER = 20f

  /** Where the column sits in a pane `width` wide, clear of `reserve` at its trailing edge when centring would run into it. */
  fun frame(width: Float, reserve: Float = 0f): Pair<Float, Float> {
    val content = max(min(MAX_WIDTH, width - GUTTER * 2), 1f)
    val centred = (width - content) / 2
    val limit = width - reserve
    if (reserve <= 0 || centred + content <= limit) return centred to content
    val room = limit - GUTTER
    // Too narrow to step aside: overlapping the card beats a sliver of text.
    if (room < 320) return centred to content
    val shifted = min(content, room)
    return max(GUTTER, limit - shifted) to shifted
  }
}

/** Lays this out in the reading column of whatever width it's offered. */
fun Modifier.readingColumn(reserve: Dp = 0.dp): Modifier = layout { measurable, constraints ->
  val width = constraints.maxWidth
  val (x, column) = ReadingColumn.frame(width.toDp().value, reserve.value)
  val placeable = measurable.measure(constraints.copy(minWidth = 0, maxWidth = column.dp.roundToPx()))
  layout(width, placeable.height) { placeable.placeRelative(x.dp.roundToPx(), 0) }
}

/** Up to `fraction` of the width offered, against the trailing edge: a sent message. */
@Composable
fun TrailingFraction(fraction: Float, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
  Layout(content, modifier) { measurables, constraints ->
    val width = constraints.maxWidth
    val p = measurables.firstOrNull()?.measure(Constraints(maxWidth = (width * fraction).toInt()))
    layout(width, p?.height ?: 0) { p?.placeRelative(width - p.width, 0) }
  }
}

/**
 * Poll while the screen is on screen (lifecycle RESUMED), and re-fetch the moment the app comes
 * back to the foreground. Lists have no push channel, so everything else is polled; a poll that
 * hits a dropped connection stays quiet.
 */
@Composable
fun LiveRefresh(enabled: Boolean, interval: Duration = 4.seconds, action: suspend () -> Unit) {
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  val latest by rememberUpdatedState(action)
  LaunchedEffect(enabled, lifecycle, interval) {
    if (!enabled) return@LaunchedEffect
    lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
      while (true) {
        quietly { latest() }
        delay(interval)
      }
    }
  }
}

/**
 * Re-fetch whatever only arrives over the socket: when the app returns to the foreground, and
 * when a connection dropped by the lock screen comes back.
 */
@Composable
fun OnResume(connected: Boolean, enabled: Boolean = true, action: suspend () -> Unit) {
  val lifecycle = LocalLifecycleOwner.current.lifecycle
  val latest by rememberUpdatedState(action)
  LaunchedEffect(enabled, connected, lifecycle) {
    if (!enabled || !connected) return@LaunchedEffect
    var first = true
    lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
      // The first start is the screen's own load; only returns count.
      if (!first) quietly { latest() }
      first = false
    }
  }
}

private suspend fun quietly(block: suspend () -> Unit) {
  try {
    block()
  } catch (e: CancellationException) {
    throw e
  } catch (_: Exception) {}
}
