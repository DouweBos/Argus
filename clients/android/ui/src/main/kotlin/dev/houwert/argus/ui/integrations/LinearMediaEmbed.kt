package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.util.LinearMediaLink
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * A Linear screenshot or screen recording in a description. Uploads are signed for the computer's
 * Linear user and only its own window can play them inline, so the phone names the upload and
 * opens it in the browser, as the iPhone app does.
 */
@Composable
fun LinearMediaEmbed(link: LinearMediaLink, onOpen: () -> Unit, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val video = link.kind == LinearMediaLink.Kind.VIDEO
  val name = link.label.ifEmpty { if (video) "Video" else "Image" }
  Row(
    modifier.fillMaxWidth().background(theme.bgSecondary, shape).border(1.dp, theme.borderSubtle, shape).padding(horizontal = 12.dp, vertical = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(if (video) IntegrationIcon.video else Icon.image, null, Modifier.size(16.dp), tint = theme.textMuted)
    Text(name, Modifier.weight(1f), color = theme.text, style = argusFont(13), maxLines = 1, overflow = TextOverflow.Ellipsis)
    AccentLink("Open", size = 13, onClick = onOpen)
  }
}
