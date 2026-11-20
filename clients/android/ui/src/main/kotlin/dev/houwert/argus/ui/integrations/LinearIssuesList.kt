package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.LinearIssueBoard
import dev.houwert.argus.core.stores.emptyText
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/**
 * Open Linear issues in one scope, or a search's results, a section per status with the most
 * urgent first — the desktop's Issues list. Tapping one opens it.
 */
@Composable
fun LinearIssuesList(
  issues: List<LinearIssue>,
  agentOnIt: (LinearIssue) -> Boolean,
  onOpen: (LinearIssue) -> Unit,
  modifier: Modifier = Modifier,
  /** A refresh that failed while issues are on screen. */
  error: String? = null,
  /** The issue open beside the list, highlighted. */
  selected: String? = null,
  contentPadding: PaddingValues = PaddingValues(16.dp),
) {
  val theme = ArgusTheme.colors
  LazyColumn(modifier.fillMaxSize(), contentPadding = contentPadding, verticalArrangement = Arrangement.spacedBy(18.dp)) {
    if (error != null) item(key = "error") { Banner(error, tone = Tone.Danger) }
    items(LinearIssueBoard.columns(issues), key = { it.id }) { column ->
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
          Modifier.padding(horizontal = 16.dp).semantics(mergeDescendants = true) { heading() },
          horizontalArrangement = Arrangement.spacedBy(6.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          IssueStatusGlyph(column.type, color = column.color, size = 12.dp)
          Text("${column.name} · ${column.issues.size}", color = theme.textMuted, style = argusFont(13, FontWeight.SemiBold))
        }
        ListSection {
          for (issue in column.issues.sortedWith(LinearIssueBoard.byPriority)) key(issue.id) {
            val interaction = rememberInteraction()
            Box(
              Modifier.fillMaxWidth()
                .argusClickable(interaction, label = "Open ${issue.identifier}") { onOpen(issue) }
                .background(if (issue.identifier == selected) theme.selection else theme.bgSecondary)
                .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
              LinearIssueCard(issue, agentOnIt(issue), style = LinearIssueCardStyle.Row)
            }
          }
        }
      }
    }
  }
}

/** Not connected, failed, loading or empty: what the Issues screen shows in place of issues. Nothing once there are some. */
@Composable
fun LinearIssuesPlaceholder(
  connected: Boolean,
  connectHint: String,
  scope: LinearIssueScope,
  query: String?,
  issues: List<LinearIssue>?,
  shownIssues: List<LinearIssue>?,
  error: String?,
  modifier: Modifier = Modifier,
) {
  when {
    !connected -> EmptyState(Icon.issue, "Linear isn't connected", modifier, body = connectHint)
    error != null && issues == null ->
      EmptyState(
        Icon.warning, if (query == null) "Couldn't fetch your issues" else "Couldn't search Linear", modifier,
        body = error, selectable = true,
      )
    issues == null ->
      Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Loading(if (query == null) "Asking Linear" else "Searching Linear")
      }
    query != null && issues.isEmpty() ->
      EmptyState(Icon.search, "No issues match “$query”", modifier, body = "Search looks through every issue in your Linear workspace.")
    issues.isEmpty() -> EmptyState(Icon.check, "No open issues", modifier, body = scope.emptyText)
    shownIssues?.isEmpty() == true -> EmptyState(Icon.filter, "No issues match", modifier, body = "Change or clear the filters to see more.")
  }
}
