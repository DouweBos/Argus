package dev.houwert.argus.ui.composer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Send while the agent works: a tap joins the running turn, a long-press offers holding it until the turn ends. */
@Composable
internal fun BusySendButton(composer: ComposerModel) {
  val theme = ArgusTheme.colors
  val haptics = LocalHapticFeedback.current
  var open by remember(composer) { mutableStateOf(false) }
  // In a Box so the menu drops from the button rather than the composer's middle.
  Box {
    ComposerRoundButton(
      ComposerRoundKind.Send, "Send",
      longClickLabel = "More send options",
      onLongClick = {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        open = true
      },
    ) { composer.submit() }
    DropdownMenu(open, { open = false }, containerColor = theme.surface) {
      DropdownMenuItem(
        text = { Text("Send after this turn", color = theme.text, style = argusFont(15)) },
        leadingIcon = { Icon(Icon.clock, null, Modifier.size(18.dp), tint = theme.textSecondary) },
        onClick = {
          open = false
          composer.submit(afterTurn = true)
        },
      )
    }
  }
}
