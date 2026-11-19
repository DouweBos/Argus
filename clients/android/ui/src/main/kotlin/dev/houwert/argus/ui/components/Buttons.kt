package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

enum class ButtonTone { Primary, Secondary, Danger, Ghost }

/**
 * The app's button. Filled buttons cap at [ArgusMetrics.maxControlWidth] and centre in the room
 * they're given; `hugs` sizes one to its label (a row of buttons), `fills` takes all the width.
 */
@Composable
fun Btn(
  label: String,
  modifier: Modifier = Modifier,
  tone: ButtonTone = ButtonTone.Primary,
  small: Boolean = false,
  icon: ImageVector? = null,
  hugs: Boolean = false,
  fills: Boolean = false,
  busy: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val interaction = rememberInteraction()
  // A disabled filled button greys out like the system's, rather than fading a near-white accent.
  val greysOut = (tone == ButtonTone.Primary || tone == ButtonTone.Secondary) && !enabled
  val foreground =
    when {
      greysOut -> theme.textMuted
      tone == ButtonTone.Primary -> theme.onAccent
      tone == ButtonTone.Secondary -> theme.text
      tone == ButtonTone.Danger -> theme.error
      else -> theme.textSecondary
    }
  val background =
    when {
      greysOut -> theme.bgTertiary
      tone == ButtonTone.Primary -> theme.accent
      tone == ButtonTone.Secondary -> theme.bgTertiary
      tone == ButtonTone.Danger -> theme.errorSoft
      else -> Color.Transparent
    }
  val capped = !(fills || tone == ButtonTone.Ghost || hugs)
  Box(
    modifier.then(if (fills || capped) Modifier.fillMaxWidth() else Modifier),
    contentAlignment = Alignment.Center,
  ) {
    Row(
      Modifier.then(
          when {
            fills -> Modifier.fillMaxWidth()
            capped -> Modifier.widthIn(max = ArgusMetrics.maxControlWidth).fillMaxWidth()
            else -> Modifier
          }
        )
        .alpha(if (!enabled && !greysOut) 0.4f else 1f)
        .argusClickable(interaction, enabled = enabled && !busy, shape = shape, label = label, onClick = onClick)
        .background(background, shape)
        .then(if (tone == ButtonTone.Secondary) Modifier.border(1.dp, theme.border, shape) else Modifier)
        .padding(vertical = if (small) 7.dp else 11.dp, horizontal = if (small) 12.dp else 14.dp),
      horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      val glyph = if (small) 13.dp else 16.dp
      when {
        busy -> CircularProgressIndicator(Modifier.size(glyph), color = foreground, strokeWidth = 2.dp)
        icon != null -> Icon(icon, null, Modifier.size(glyph), tint = foreground)
      }
      Text(
        label, color = foreground, style = argusFont(if (small) 13 else 15, FontWeight.SemiBold), maxLines = 1,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}

/** An icon-only button with a full-size touch target; `label` is what TalkBack reads. */
@Composable
fun IconBtn(
  icon: ImageVector,
  label: String,
  modifier: Modifier = Modifier,
  size: Dp = 20.dp,
  tint: Color? = null,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Box(
    modifier
      .size(ArgusMetrics.minTouchTarget)
      .argusClickable(interaction, enabled, shape = RoundedCornerShape(50), label = label, onClick = onClick)
      .alpha(if (enabled) 1f else 0.4f),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, label, Modifier.size(size), tint = tint ?: theme.textSecondary)
  }
}

/** A text-only action in the accent: a link-looking button. */
@Composable
fun AccentLink(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, size: Int = 15, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Text(
    label,
    modifier
      .argusClickable(interaction, enabled, RoundedCornerShape(4.dp), label = label, onClick = onClick)
      .alpha(if (interaction.pressed) 0.6f else 1f)
      .padding(vertical = 4.dp, horizontal = 2.dp),
    color = if (enabled) theme.accent else theme.textMuted,
    style = argusFont(size, FontWeight.Medium).copy(
      textDecoration = if (interaction.hovered && enabled) androidx.compose.ui.text.style.TextDecoration.Underline else null
    ),
  )
}
