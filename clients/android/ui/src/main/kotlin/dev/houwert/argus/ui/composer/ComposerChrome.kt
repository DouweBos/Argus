package dev.houwert.argus.ui.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.icons.arrowUp
import dev.houwert.argus.ui.icons.stopFilled
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** A composer setting as an inline pill: icon, value and a chevron, quiet until pressed or open. */
@Composable
fun ComposerPillLabel(
  icon: ImageVector,
  contentDescription: String,
  modifier: Modifier = Modifier,
  title: String? = null,
  accent: Boolean = false,
  chevron: Boolean = true,
  open: Boolean = false,
  enabled: Boolean = true,
  onClick: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val shape = RoundedCornerShape(6.dp)
  val active = (interaction.pressed || open) && enabled
  val tint = when {
    !enabled -> theme.textMuted
    accent -> theme.accent
    active -> theme.text
    else -> theme.textSecondary
  }
  Row(
    modifier
      .height(ComposerMetrics.pillHeight)
      .argusClickable(interaction, enabled, shape, label = contentDescription, onClick = onClick)
      .background(if (active) theme.selection else Color.Transparent, shape)
      .padding(horizontal = 7.dp)
      .clearAndSetSemantics {
        this.contentDescription = contentDescription
        role = Role.Button
      },
    horizontalArrangement = Arrangement.spacedBy(5.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(icon, null, Modifier.size(15.dp), tint = tint)
    if (title != null) Text(title, color = tint, style = argusFont(14), maxLines = 1)
    if (chevron) Icon(Icon.chevronDown, null, Modifier.size(11.dp), tint = tint)
  }
}

/** The hairline between two pills. */
@Composable
fun ComposerPillDivider() {
  Box(Modifier.width(1.dp).height(12.dp).background(ArgusTheme.colors.border))
}

enum class ComposerRoundKind { Send, Stop }

/** The composer's round send and stop buttons. */
@Composable
fun ComposerRoundButton(kind: ComposerRoundKind, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  // Disabled drops to a solid muted fill; fading the accent left it unreadable on dark backgrounds.
  val fill = if (kind == ComposerRoundKind.Send && enabled) theme.accent else theme.bgHover
  val tint = when {
    !enabled -> theme.textMuted
    kind == ComposerRoundKind.Send -> theme.onAccent
    else -> theme.text
  }
  Box(
    modifier
      .size(ComposerMetrics.roundButton)
      .argusClickable(interaction, enabled, CircleShape, label = label, onClick = onClick)
      .background(fill, CircleShape)
      .then(if (enabled) Modifier else Modifier.border(1.dp, theme.border, CircleShape)),
    contentAlignment = Alignment.Center,
  ) {
    Icon(
      if (kind == ComposerRoundKind.Send) Icon.arrowUp else Icon.stopFilled, label,
      Modifier.size(if (kind == ComposerRoundKind.Send) 18.dp else 13.dp), tint = tint,
    )
  }
}

object ComposerMetrics {
  /** A finger needs a taller target than a pointer. */
  val pillHeight: Dp = 32.dp
  val roundButton: Dp = 34.dp
  val boxRadius: Dp = 18.dp
  val collapsedFieldHeight: Dp = 36.dp
  val maxFieldHeight: Dp = 120.dp
}
