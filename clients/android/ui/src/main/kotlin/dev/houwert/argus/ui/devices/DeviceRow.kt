package dev.houwert.argus.ui.devices

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone

/** One device in a list: running or not, its name, the runtime it boots, and whether it streams. */
@Composable
fun DeviceRow(
  name: String,
  detail: String,
  booted: Boolean,
  isTv: Boolean,
  live: Boolean,
  modifier: Modifier = Modifier,
  onClick: (() -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  ListRow(
    title = name,
    subtitle = detail,
    modifier = modifier,
    onClick = onClick,
    leading = {
      Box(Modifier.size(28.dp), contentAlignment = Alignment.Center) {
        Icon(if (isTv) Icon.tv else Icon.devices, null, Modifier.size(22.dp), tint = if (booted) theme.text else theme.textMuted)
        StatusDot(
          if (booted) Tone.Success else Tone.Muted,
          Modifier.align(Alignment.BottomEnd).offset(x = 4.dp, y = 3.dp).background(theme.bgSecondary, CircleShape).padding(2.dp),
          contentDescription = if (booted) "Running" else "Stopped",
        )
      }
    },
    trailing = { if (live) Badge("Live", tone = Tone.Success) },
  )
}
