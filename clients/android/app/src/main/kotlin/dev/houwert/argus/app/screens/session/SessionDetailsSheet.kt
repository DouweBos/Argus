package dev.houwert.argus.app.screens.session

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * The session's details as a bottom sheet: opens half height on the tools,
 * drags up to full for the rest, as the phone's medium and large detents.
 * [open] pushes a screen (the caller dismisses first); [agentId] is the agent in front.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionDetailsSheet(
  session: RemoteSession,
  agentId: String?,
  open: (Route) -> Unit,
  newAgent: () -> Unit,
  deleted: () -> Unit,
  onDismiss: () -> Unit,
) {
  val host = LocalAppStore.current.host
  val theme = ArgusTheme.colors
  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
    containerColor = theme.bg,
    contentColor = theme.text,
  ) {
    SessionDetailsContent(
      host,
      session,
      agentId,
      open = { route ->
        onDismiss()
        open(route)
      },
      newAgent = {
        onDismiss()
        newAgent()
      },
      deleted = {
        onDismiss()
        deleted()
      },
      modifier = Modifier.fillMaxWidth(),
    )
  }
}
