package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.Chip
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * Find Linear issues to start agents on: the connected user's open ones, or a search. Several can
 * be picked; each gets its own worktree and agent. `search` is `HostStore.linearIssues`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssuePickerSheet(
  selection: List<LinearIssue>,
  onSelectionChange: (List<LinearIssue>) -> Unit,
  search: suspend (String) -> List<LinearIssue>,
  onDismiss: () -> Unit,
) {
  val theme = ArgusTheme.colors
  var query by rememberSaveable { mutableStateOf("") }
  var results by remember { mutableStateOf(emptyList<LinearIssue>()) }
  var searching by remember { mutableStateOf(true) }
  var error by remember { mutableStateOf<String?>(null) }
  val latestSearch by rememberUpdatedState(search)
  LaunchedEffect(query) {
    // Typing restarts this; only a pause asks Linear.
    if (query.isNotEmpty()) delay(250)
    searching = true
    try {
      results = latestSearch(query)
      error = null
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      error = HostStore.describe(e)
    } finally {
      searching = false
    }
  }
  ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(), containerColor = theme.bg, contentColor = theme.text) {
    Column(Modifier.navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).height(44.dp), contentAlignment = Alignment.Center) {
        Text("Linear Issues", color = theme.text, style = ArgusTheme.typography.headline)
        AccentLink("Done", Modifier.align(Alignment.CenterEnd), size = 17, onClick = onDismiss)
      }
      ThemedTextField(query, { query = it }, "Search, ENG-123 or an issue link", Modifier.padding(horizontal = 16.dp), input = TextInput.Code)
      when {
        error != null -> MutedText(error!!, Modifier.padding(horizontal = 16.dp))
        results.isEmpty() && searching -> Loading("Asking Linear")
        results.isEmpty() ->
          MutedText(if (query.isEmpty()) "No open issues assigned to you." else "No issues match.", Modifier.padding(horizontal = 16.dp))
        else ->
          LazyColumn(Modifier.heightIn(max = 560.dp).padding(horizontal = 8.dp).padding(bottom = 12.dp)) {
            items(results, key = { it.id }) { issue ->
              val picked = selection.any { it.id == issue.id }
              MenuRow(
                "${issue.identifier}, ${issue.title}", role = Role.Checkbox, selected = picked,
                onClick = { onSelectionChange(if (picked) selection.filterNot { it.id == issue.id } else selection + issue) },
              ) {
                Column(Modifier.weight(1f).padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                  Text(issue.title, color = theme.text, style = argusFont(15), maxLines = 2, overflow = TextOverflow.Ellipsis)
                  Text("${issue.identifier} · ${issue.state.name}", color = theme.textMuted, style = argusFont(12, mono = true))
                }
                if (picked) Icon(Icon.check, "Picked", Modifier.size(16.dp), tint = theme.accent)
              }
            }
          }
      }
    }
  }
}

/** The issues picked for a start, each removable. */
@Composable
fun PickedIssueChips(issues: List<LinearIssue>, onRemove: (LinearIssue) -> Unit, modifier: Modifier = Modifier) {
  FlowRow(modifier, spacing = 6.dp, rowSpacing = 6.dp, packed = true) {
    for (issue in issues) {
      Chip(
        "${issue.identifier} ${issue.title}", icon = Icon.close, tone = Tone.Accent,
        contentDescription = "Remove ${issue.identifier}", onClick = { onRemove(issue) },
      )
    }
  }
}
