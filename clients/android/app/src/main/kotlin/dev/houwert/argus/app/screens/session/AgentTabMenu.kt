package dev.houwert.argus.app.screens.session

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.stores.MovedChat
import dev.houwert.argus.core.stores.canTogglePin
import dev.houwert.argus.core.stores.isPinned
import dev.houwert.argus.core.stores.setPinned
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.ui.components.ListRow
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/**
 * A tab's long-press menu, the iPhone's tab context menu as a bottom sheet: pin,
 * continue on another runner, move to another session, close a stopped tab, shut down.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentTabMenu(
  agentId: String,
  isDraft: Boolean,
  canClose: Boolean,
  onDismiss: () -> Unit,
  onCloseDraft: () -> Unit,
  onCloseTab: () -> Unit,
  onStop: () -> Unit,
  onContinued: (RemoteAgentStatus) -> Unit,
  onMoved: (MovedChat) -> Unit,
  onError: (title: String, message: String) -> Unit,
) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val theme = ArgusTheme.colors
  val gone = host.isGone(agentId)
  var moving by remember { mutableStateOf(false) }
  fun run(action: () -> Unit) {
    onDismiss()
    action()
  }
  if (moving) {
    MoveToAgentSheet(agentId, onMoved = { run { onMoved(it) } }, onError = { run { onError("Couldn't move the chat", it) } }, onDismiss = onDismiss)
    return
  }
  ModalBottomSheet(onDismissRequest = onDismiss, containerColor = theme.bgSecondary) {
    Column(Modifier.padding(bottom = 24.dp)) {
      if (isDraft) {
        if (canClose) ListRow("Close", icon = Icon.close, onClick = { run(onCloseDraft) })
        return@Column
      }
      if (host.hasControl && host.canTogglePin(agentId)) {
        val pinned = host.isPinned(agentId)
        ListRow(if (pinned) "Unpin chat" else "Pin chat", icon = if (pinned) Icon.pinSlash else Icon.pin, chevron = false, onClick = {
          run { scope.launch { host.setPinned(agentId, !pinned) } }
        })
      }
      if (!gone) {
        ContinueOnAgentItems(agentId, onContinued = { run { onContinued(it) } }, onError = { run { onError("Couldn't continue the chat", it) } })
        if (host.hasControl) ListRow("Move to", icon = Icon.branch, onClick = { moving = true })
      }
      if (gone) {
        if (canClose) ListRow("Close tab", icon = Icon.close, onClick = { run(onCloseTab) })
      } else if (host.hasControl) {
        ListRow("Shut down", icon = Icon.stop, tone = Tone.Danger, chevron = false, onClick = { run(onStop) })
      }
    }
  }
}
