package dev.houwert.argus.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** A one-line capsule label in a tone. Never wraps. */
@Composable
fun Badge(label: String, modifier: Modifier = Modifier, tone: Tone = Tone.Muted) {
  val theme = ArgusTheme.colors
  Text(
    label,
    modifier.clip(CircleShape).background(tone.soft(theme)).padding(horizontal = 7.dp, vertical = 3.dp),
    color = tone.color(theme),
    style = argusFont(11, FontWeight.SemiBold),
    maxLines = 1,
  )
}

/** A capsule label, tappable with `onClick`. An empty label beside an icon shows just the icon. */
@Composable
fun Chip(
  label: String,
  modifier: Modifier = Modifier,
  icon: ImageVector? = null,
  tone: Tone? = null,
  mono: Boolean = false,
  contentDescription: String? = null,
  onClick: (() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val foreground = tone?.color(theme) ?: theme.textSecondary
  val interaction = rememberInteraction()
  Row(
    modifier
      .clip(CircleShape)
      .then(if (onClick != null) Modifier.argusClickable(interaction, shape = CircleShape, label = contentDescription ?: label, onClick = onClick) else Modifier)
      .background(tone?.soft(theme) ?: theme.bgTertiary)
      .padding(horizontal = 9.dp, vertical = 5.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (icon != null) Icon(icon, contentDescription.takeIf { label.isEmpty() }, Modifier.size(12.dp), tint = foreground)
    if (label.isNotEmpty() || icon == null) {
      Text(label, color = foreground, style = argusFont(12, mono = mono), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
  }
}

/**
 * A tinted strip that says what happened (`title`) and why (`text`), with an optional trailing
 * action and a close button for one that stays until dismissed.
 */
@Composable
fun Banner(
  text: String,
  modifier: Modifier = Modifier,
  tone: Tone = Tone.Warning,
  title: String? = null,
  actionLabel: String? = null,
  actionTone: ButtonTone = ButtonTone.Secondary,
  onAction: (() -> Unit)? = null,
  onDismiss: (() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  Row(
    modifier
      .fillMaxWidth()
      .height(IntrinsicSize.Min)
      .clip(RoundedCornerShape(ArgusMetrics.radiusSmall))
      .background(tone.soft(theme)),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    androidx.compose.foundation.layout.Box(Modifier.width(3.dp).fillMaxHeight().background(tone.color(theme)))
    Row(
      Modifier.weight(1f).padding(start = 10.dp, top = 10.dp, bottom = 10.dp, end = 10.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        if (title != null) Text(title, color = tone.color(theme), style = argusFont(13, FontWeight.SemiBold))
        Text(text, color = theme.text, style = argusFont(13))
      }
      if (actionLabel != null && onAction != null) {
        Btn(actionLabel, tone = actionTone, small = true, hugs = true, onClick = onAction)
      }
      if (onDismiss != null) {
        IconBtn(Icon.close, "Dismiss", Modifier.size(32.dp), size = 14.dp, onClick = onDismiss)
      }
    }
  }
}

/**
 * A 7dp dot in a tone; `pulse` fades it in and out (busy). Without `contentDescription` it's
 * decoration.
 */
@Composable
fun StatusDot(tone: Tone, modifier: Modifier = Modifier, pulse: Boolean = false, contentDescription: String? = null) {
  val color = tone.color(ArgusTheme.colors)
  val alpha =
    if (pulse) {
      val transition = rememberInfiniteTransition(label = "pulse")
      transition.animateFloat(1f, 0.3f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "alpha").value
    } else {
      1f
    }
  Canvas(
    modifier.size(7.dp).clearAndSetSemantics { if (contentDescription != null) this.contentDescription = contentDescription }
  ) {
    drawCircle(color, alpha = alpha)
  }
}
