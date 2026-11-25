package dev.houwert.argus.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role

/** Whether a control is under a finger or a pointer: the Swift styles' `isPressed` and `onHover`. */
class Interaction(val source: MutableInteractionSource, val pressed: Boolean, val hovered: Boolean)

@Composable
fun rememberInteraction(): Interaction {
  val source = remember { MutableInteractionSource() }
  return Interaction(source, source.collectIsPressedAsState().value, source.collectIsHoveredAsState().value)
}

/**
 * The one way a component becomes tappable: a ripple clipped to its shape, the button role, and
 * the interaction source its own pressed/hover fills read. `ripple = false` when the component's
 * own fill is the whole indication.
 */
fun Modifier.argusClickable(
  interaction: Interaction,
  enabled: Boolean = true,
  shape: Shape = RectangleShape,
  role: Role = Role.Button,
  label: String? = null,
  ripple: Boolean = true,
  longClickLabel: String? = null,
  onLongClick: (() -> Unit)? = null,
  onClick: () -> Unit,
): Modifier =
  clip(shape).then(
    if (onLongClick == null) Modifier.clickable(
      interactionSource = interaction.source,
      indication = if (ripple) ripple() else null,
      enabled = enabled,
      onClickLabel = label,
      role = role,
      onClick = onClick,
    ) else Modifier.combinedClickable(
      interactionSource = interaction.source,
      indication = if (ripple) ripple() else null,
      enabled = enabled,
      onClickLabel = label,
      role = role,
      onLongClickLabel = longClickLabel,
      onLongClick = onLongClick,
      onClick = onClick,
    ),
  )

/** A tappable toggle (checkbox, switch row) with the same treatment. */
fun Modifier.argusToggleable(
  value: Boolean,
  interaction: Interaction,
  enabled: Boolean = true,
  shape: Shape = RectangleShape,
  role: Role = Role.Checkbox,
  onValueChange: (Boolean) -> Unit,
): Modifier =
  clip(shape)
    .toggleable(
      value = value,
      interactionSource = interaction.source,
      indication = ripple(),
      enabled = enabled,
      role = role,
      onValueChange = onValueChange,
    )
