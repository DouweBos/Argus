package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.util.ArtifactLink
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** An Artifact the agent published or opened, shown as the page it is: its title, what the agent said it is, a way to look at it. */
@Composable
internal fun ArtifactCard(link: ArtifactLink, call: RemoteToolCall) {
  val theme = ArgusTheme.colors
  val open = LocalTranscript.current?.openArtifact
  val uri = LocalUriHandler.current
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val detail = call.input["description"].stringValue?.ifEmpty { null }
    ?: if (link.action == ArtifactLink.Action.PUBLISH) "Artifact published" else "Artifact opened"
  Row(
    Modifier.fillMaxWidth()
      .argusClickable(rememberInteraction(), shape = shape, label = "Open artifact ${link.title}") {
        if (open != null) open(link) else runCatching { uri.openUri(link.url) }
      }
      .background(theme.accentSoft)
      .border(1.dp, theme.accentBorder, shape)
      .padding(9.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.size(32.dp).clip(shape).background(theme.bg), contentAlignment = Alignment.Center) {
      Icon(Icon.artifact, null, Modifier.size(18.dp), tint = theme.accent)
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(link.title, color = theme.text, style = argusFont(14, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(detail, color = theme.textSecondary, style = argusFont(12), maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
    Text("Open", color = theme.accent, style = argusFont(12, FontWeight.Medium))
  }
}
