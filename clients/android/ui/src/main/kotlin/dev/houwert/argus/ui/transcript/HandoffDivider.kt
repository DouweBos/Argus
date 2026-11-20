package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteMessageHandoff
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/** Where a chat moved to another runner: a rule with the hop in the middle. */
@Composable
fun HandoffDivider(handoff: RemoteMessageHandoff, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(
    modifier.fillMaxWidth().padding(vertical = 4.dp).semantics(mergeDescendants = true) {},
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.weight(1f).height(1.dp).background(theme.border))
    Icon(Icon.continueOn, null, Modifier.size(13.dp), tint = theme.textMuted)
    Text(
      "Continued on ${handoff.toRunner} from ${handoff.fromRunner}", color = theme.textMuted,
      style = argusFont(12, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis,
    )
    Box(Modifier.weight(1f).height(1.dp).background(theme.border))
  }
}
