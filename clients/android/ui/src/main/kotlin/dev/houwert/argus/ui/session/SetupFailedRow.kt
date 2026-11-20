package dev.houwert.argus.ui.session

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionDeleteFailed
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon as Glyph
import dev.houwert.argus.ui.theme.ArgusTheme

/** What a failed setup or delete lets you do; each call goes to the host. */
class SetupFailedActions(
  val retrySetup: suspend () -> Unit,
  val markReady: suspend () -> Unit,
  val retryDelete: suspend () -> Unit,
  /** Delete without running the teardown commands again. */
  val deleteAnyway: suspend () -> Unit,
)

/**
 * Why a session's setup or delete failed, with the ways out: run setup again
 * or mark it ready; retry the delete, or after a failed teardown delete anyway.
 */
@Composable
fun SetupFailedRow(session: RemoteSession, hasControl: Boolean, actions: SetupFailedActions, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val action = rememberBusyAction()
  var expanded by rememberSaveable(session.id) { mutableStateOf(false) }
  Column(modifier.padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
      Icon(Glyph.warning, contentDescription = null, Modifier.size(16.dp), tint = theme.error)
      Text(
        SetupFailedText.title(session.deleteFailed),
        style = ArgusTheme.typography.subheadline.copy(fontWeight = FontWeight.SemiBold),
        color = theme.error,
      )
    }
    session.setupError?.takeIf { it.isNotEmpty() }?.let { message ->
      // The cause is at the end; the start is usually checkout progress.
      val interaction = rememberInteraction()
      SelectionContainer {
        MonoText(
          if (expanded) message else SetupFailedText.tail(message),
          Modifier.argusClickable(interaction, label = if (expanded) "Collapse" else "Expand") { expanded = !expanded },
          color = theme.textSecondary,
          maxLines = if (expanded) Int.MAX_VALUE else 4,
        )
      }
    }
    if (hasControl) {
      FlowRow(packed = true) {
        val enabled = !action.busy
        if (session.deleteFailed != null) {
          Btn("Retry", small = true, icon = Glyph.refresh, hugs = true, enabled = enabled) { action.run(actions.retryDelete) }
          if (session.deleteFailed == RemoteSessionDeleteFailed.teardown) {
            Btn("Delete anyway", tone = ButtonTone.Danger, small = true, icon = Glyph.trash, hugs = true, enabled = enabled) {
              action.run(actions.deleteAnyway)
            }
          }
        } else {
          Btn("Retry", small = true, icon = Glyph.refresh, hugs = true, enabled = enabled) { action.run(actions.retrySetup) }
          Btn("Mark as ready", tone = ButtonTone.Secondary, small = true, icon = Glyph.check, hugs = true, enabled = enabled) {
            action.run(actions.markReady)
          }
        }
      }
    }
  }
}

object SetupFailedText {
  /** The last lines of a long error: the cause is at the end. */
  fun tail(message: String, lines: Int = 4): String = message.trimEnd().lines().takeLast(lines).joinToString("\n")

  fun title(deleteFailed: RemoteSessionDeleteFailed?): String =
    when (deleteFailed) {
      RemoteSessionDeleteFailed.teardown -> "Teardown failed"
      RemoteSessionDeleteFailed.remove -> "Delete failed"
      else -> "Setup failed"
    }
}
