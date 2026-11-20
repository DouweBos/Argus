package dev.houwert.argus.ui.session

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.icons.Icon as Glyph
import dev.houwert.argus.ui.icons.info
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * A worktree made outside Argus: offer the project's setup it never got, or to
 * leave it as it is. Buttons only show with [hasControl].
 */
@Composable
fun SetupPendingRow(
  hasControl: Boolean,
  runSetup: suspend () -> Unit,
  skip: suspend () -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  val action = rememberBusyAction()
  Column(modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Icon(Glyph.info, contentDescription = null, Modifier.size(16.dp), tint = theme.text)
      Text("Setup never ran", style = ArgusTheme.typography.subheadline.copy(fontWeight = FontWeight.SemiBold))
    }
    Text(
      "This worktree was made outside Argus, so the project's setup hasn't run in it.",
      style = ArgusTheme.typography.caption,
      color = theme.textSecondary,
    )
    if (hasControl) {
      FlowRow(packed = true) {
        Btn("Run setup", small = true, icon = Glyph.play, hugs = true, enabled = !action.busy) { action.run(runSetup) }
        Btn("Skip", tone = ButtonTone.Secondary, small = true, hugs = true, enabled = !action.busy) { action.run(skip) }
      }
    }
  }
}
