package dev.houwert.argus.app.screens.session

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * A wide window's session side panel: a trailing column beside the chat with the
 * same rows as the details sheet. What it opens goes through [open].
 */
@Composable
fun SessionSidePanel(
  session: RemoteSession,
  agentId: String?,
  modifier: Modifier = Modifier,
  open: (Route) -> Unit,
  newAgent: () -> Unit = {},
  deleted: () -> Unit = {},
) {
  val host = LocalAppStore.current.host
  val theme = ArgusTheme.colors
  Row(modifier.fillMaxHeight()) {
    VerticalDivider(color = theme.border)
    SessionDetailsContent(
      host,
      session,
      agentId,
      open = open,
      newAgent = newAgent,
      deleted = deleted,
      modifier = Modifier.width(SidePanelWidth).fillMaxHeight().background(theme.bg),
    )
  }
}

/** Between the iPad panel's 300 and 600 points: room for a row's label and its value. */
val SidePanelWidth = 360.dp
