package dev.houwert.argus.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** The connection state in words, for wherever the badge's dot needs spelling out. */
val Transport.State.label: String
  get() =
    when (this) {
      Transport.State.Ready -> "Connected"
      Transport.State.Offline -> "Reconnecting"
      Transport.State.Connecting -> "Connecting"
      Transport.State.Handshaking -> "Securing"
    }

val Transport.State.tone: Tone
  get() =
    when (this) {
      Transport.State.Ready -> Tone.Success
      Transport.State.Offline -> Tone.Warning
      Transport.State.Connecting, Transport.State.Handshaking -> Tone.Muted
    }

/**
 * A fixed-size dot in every state, on purpose: it lives in an app bar, where a label that grows
 * to "Connecting" leaves dead space behind. The words belong in the in-screen banner.
 */
@Composable
fun ConnectionBadge(state: Transport.State, modifier: Modifier = Modifier) {
  StatusDot(state.tone, modifier.padding(horizontal = 8.dp), pulse = state != Transport.State.Ready, contentDescription = state.label)
}

/** What a computer lets this device do, in words rather than tier names. */
object GrantLabel {
  fun text(capabilities: List<String>): String =
    when {
      "admin" in capabilities -> "Full access"
      "control" in capabilities -> "Full control"
      "monitor" in capabilities -> "Watch and approve"
      else -> "Nothing yet"
    }
}

/** Said wherever a watch-only device hits something that needs control; `action` ends the sentence. */
@Composable
fun ControlRequiredBanner(action: String, modifier: Modifier = Modifier) {
  Banner(
    "This device can watch but not control. Grant it control in Argus on your computer, under Settings → Remote, to $action.",
    modifier,
  )
}

/** Three dots bouncing in sequence: the "still working" tell. */
@Composable
fun ThinkingDots(modifier: Modifier = Modifier, size: Dp = 4.dp, tint: Color? = null) {
  val color = tint ?: ArgusTheme.colors.textMuted
  val transition = rememberInfiniteTransition(label = "dots")
  // The stagger is the whole effect; without it they pulse as one.
  val lifts =
    (0 until 3).map { i ->
      transition.animateFloat(
        0f, 1f, infiniteRepeatable(tween(380), RepeatMode.Reverse, StartOffset(i * 130)), label = "dot$i",
      )
    }
  val lift = size * 0.9f
  Canvas(modifier.size(width = size * 3 + size * 0.75f * 2, height = size + lift * 2).clearAndSetSemantics {}) {
    val r = size.toPx() / 2
    val step = size.toPx() * 1.75f
    lifts.forEachIndexed { i, t ->
      val y = this.size.height / 2 - t.value * lift.toPx()
      drawCircle(color, r, Offset(r + i * step, y))
    }
  }
}

/** "128k": a token count as tight as a meter needs. */
fun formatTokens(count: Int): String =
  when {
    count >= 1_000_000 -> String.format(java.util.Locale.US, "%.1fM", count / 1_000_000.0)
    count >= 1_000 -> "${count / 1000}k"
    else -> "$count"
  }

/** The context window's fill ring and token count; warns past 70%, alarms past 90%. */
@Composable
fun ContextMeter(tokens: Int, limit: Int, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val fraction = if (limit > 0) (tokens.toFloat() / limit).coerceAtMost(1f) else 0f
  val tone =
    when {
      fraction > 0.9f -> Tone.Danger
      fraction > 0.7f -> Tone.Warning
      else -> Tone.Accent
    }
  Row(
    modifier.semantics(mergeDescendants = true) { contentDescription = "Context ${(fraction * 100).toInt()} percent full" },
    horizontalArrangement = Arrangement.spacedBy(5.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Canvas(Modifier.size(18.dp)) {
      val ring = 2.5.dp.toPx()
      val inset = ring / 2
      val arc = Size(size.width - ring, size.height - ring)
      drawArc(theme.bgHover, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(ring))
      drawArc(tone.color(theme), -90f, 360f * fraction, false, Offset(inset, inset), arc, style = Stroke(ring, cap = StrokeCap.Round))
    }
    Text(formatTokens(tokens), color = theme.textMuted, style = argusFont(11), maxLines = 1)
  }
}

/**
 * What the agent is doing right now: a pulsing dot, the activity, bouncing dots. `blocked`
 * (waiting on a permission) turns the dot amber. Screens derive `text` from the agent's activity.
 */
@Composable
fun WorkingIndicator(text: String, modifier: Modifier = Modifier, blocked: Boolean = false) {
  Row(
    modifier.padding(vertical = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    StatusDot(if (blocked) Tone.Warning else Tone.Accent, pulse = true)
    Text(text, color = ArgusTheme.colors.textSecondary, style = argusFont(13))
    ThinkingDots()
  }
}
