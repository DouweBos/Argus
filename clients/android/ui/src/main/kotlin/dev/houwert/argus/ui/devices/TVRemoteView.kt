package dev.houwert.argus.ui.devices

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.delay

/**
 * A TV's clickpad, mirroring the desktop's remote. A TV has no touchscreen, so the
 * stream is a picture and this is the only way to drive it. [press] takes the host's button ids.
 */
@Composable
fun TVRemoteView(press: (String) -> Unit, isAndroid: Boolean, modifier: Modifier = Modifier) {
  var active by remember { mutableStateOf<String?>(null) }
  // Flash the pressed control: the stream is a second or so behind.
  LaunchedEffect(active) {
    if (active != null) {
      delay(150)
      active = null
    }
  }
  val fire: (String) -> Unit = { id ->
    active = id
    press(id)
  }
  Column(
    modifier.padding(ArgusMetrics.space),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Clickpad(active, fire)
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      if (isAndroid) {
        RemotePill("Back", Icon.androidBack, "back", active, fire)
        RemotePill("Home", Icon.home, "home", active, fire)
      } else {
        RemotePill("Menu", Icon.menu, "menu", active, fire)
        RemotePill("Play or pause", Icon.playPause, "playpause", active, fire)
        RemotePill("Home", Icon.home, "home", active, fire)
      }
    }
  }
}

private val PadSize = 220.dp

@Composable
private fun Clickpad(active: String?, fire: (String) -> Unit) {
  val theme = ArgusTheme.colors
  Box(
    Modifier.size(PadSize).background(theme.bgSecondary, CircleShape).border(1.dp, theme.border, CircleShape),
    contentAlignment = Alignment.Center,
  ) {
    val reach = PadSize * 0.33f
    Arrow(Icon.chevronUp, "up", "Up", active, fire, Modifier.offset(y = -reach))
    Arrow(Icon.chevronDown, "down", "Down", active, fire, Modifier.offset(y = reach))
    Arrow(Icon.chevronLeft, "left", "Left", active, fire, Modifier.offset(x = -reach))
    Arrow(Icon.chevronRight, "right", "Right", active, fire, Modifier.offset(x = reach))
    val interaction = rememberInteraction()
    Box(
      Modifier.size(PadSize * 0.4f)
        .argusClickable(interaction, shape = CircleShape, label = "Select") { fire("select") }
        .background(if (active == "select") theme.accentSoft else theme.bgTertiary, CircleShape)
        .border(1.dp, theme.border, CircleShape),
    )
  }
}

@Composable
private fun Arrow(icon: ImageVector, id: String, label: String, active: String?, fire: (String) -> Unit, modifier: Modifier) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  Box(
    modifier.size(52.dp).argusClickable(interaction, shape = CircleShape, label = label) { fire(id) },
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, null, Modifier.size(28.dp), tint = if (active == id) theme.accent else theme.textSecondary)
  }
}

@Composable
private fun RemotePill(label: String, icon: ImageVector, id: String, active: String?, fire: (String) -> Unit) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val on = active == id
  Box(
    Modifier.size(width = 56.dp, height = 40.dp)
      .argusClickable(interaction, shape = shape, label = label) { fire(id) }
      .background(if (on) theme.accentSoft else theme.bgTertiary, shape)
      .border(1.dp, if (on) theme.accentBorder else theme.border, shape),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, null, Modifier.size(20.dp), tint = if (on) theme.accent else theme.text)
  }
}
