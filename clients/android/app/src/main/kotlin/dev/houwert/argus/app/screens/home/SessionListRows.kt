package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.compare.compareSlotTitle
import dev.houwert.argus.core.sessions.SessionListRow
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.isUnavailable
import dev.houwert.argus.ui.sessions.CompareRunHeaderRow
import dev.houwert.argus.ui.sessions.SessionRow
import dev.houwert.argus.ui.sessions.SessionRowMenuItems
import dev.houwert.argus.ui.sessions.SessionTriageSheet
import dev.houwert.argus.ui.theme.ArgusTheme

/** A row that opens on tap and shows its menu on long press, as iOS rows' context menus do. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PressableRow(
  label: String,
  modifier: Modifier = Modifier,
  enabled: Boolean = true,
  onClick: () -> Unit,
  menu: (@Composable ColumnScope.(dismiss: () -> Unit) -> Unit)? = null,
  content: @Composable () -> Unit,
) {
  var open by remember { mutableStateOf(false) }
  Box(
    Modifier.fillMaxWidth()
      .combinedClickable(
        enabled = enabled, onClickLabel = label, onLongClickLabel = if (menu != null) "More actions" else null,
        onLongClick = if (menu != null) ({ open = true }) else null, onClick = onClick,
      )
      .then(modifier),
  ) {
    content()
    if (menu != null) DropdownMenu(open, { open = false }) { menu { open = false } }
  }
}

/**
 * One row of a session list: a session (tap opens it, long press triages it) or a compare run's
 * header. Home's cards and the project screen share it.
 */
@Composable
fun SessionListRowView(
  host: HostStore,
  row: SessionListRow,
  open: (SessionListRow.Session) -> Unit,
  openCompare: (String) -> Unit,
  present: (SessionTriageSheet) -> Unit,
  git: RemoteGitStatus? = null,
  detailed: Boolean = false,
  extraMenu: (@Composable ColumnScope.(RemoteSession, () -> Unit) -> Unit)? = null,
) {
  val padding = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
  when (row) {
    is SessionListRow.CompareHeader -> PressableRow("Open ${row.run.title}", padding, onClick = { openCompare(row.run.id) }) {
      CompareRunHeaderRow(row.run)
    }
    is SessionListRow.Session -> {
      val session = row.group.session
      PressableRow(
        "Open ${row.group.label}", padding, enabled = session?.isUnavailable != true, onClick = { open(row) },
        menu = session?.let { s ->
          { dismiss ->
            SessionRowMenuItems(host, s, dismiss, present)
            extraMenu?.invoke(this, s, dismiss)
          }
        },
      ) {
        if (session != null) {
          SessionRow(
            session, row.group.agents, git = git, detailed = detailed, caption = row.placement.caption,
            title = if (row.placement.slot) session.compareGroup?.let { host.compareSlotTitle(it) } else null,
            indent = row.placement.indent, stacked = row.placement.stacked,
          )
        } else {
          // Known only from its agents until the project's sessions load.
          Text(row.group.label, Modifier.padding(start = 18.dp).alpha(1f), color = ArgusTheme.colors.text, maxLines = 1)
        }
      }
    }
  }
}
