package dev.houwert.argus.ui.composer

import androidx.compose.foundation.focusable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type

/**
 * Turns a hardware keyboard's arrows, Enter and Escape into d-pad presses (`up`, `select`, `menu`,
 * as the host names them), for a TV device's remote. Takes focus when it appears.
 */
@Composable
fun Modifier.hardwareKeyCatcher(press: (String) -> Unit): Modifier {
  val focus = remember { FocusRequester() }
  LaunchedEffect(focus) { runCatching { focus.requestFocus() } }
  return this.focusRequester(focus).focusable().onKeyEvent { event ->
    if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
    val button = HardwareKeys.button(event.key) ?: return@onKeyEvent false
    press(button)
    true
  }
}

object HardwareKeys {
  fun button(key: Key): String? = when (key) {
    Key.DirectionUp -> "up"
    Key.DirectionDown -> "down"
    Key.DirectionLeft -> "left"
    Key.DirectionRight -> "right"
    Key.Enter, Key.NumPadEnter, Key.DirectionCenter -> "select"
    Key.Escape, Key.Back -> "menu"
    else -> null
  }
}
