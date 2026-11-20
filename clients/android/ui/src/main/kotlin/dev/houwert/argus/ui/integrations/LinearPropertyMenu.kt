package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.LinearIssueProperty
import dev.houwert.argus.core.stores.LinearPropertyMenu
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailStatusHistoryItem
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont

/**
 * An enum property (status, priority) as Linear draws it: a row that opens a searchable sheet of
 * its values, the current one ticked.
 */
@Composable
fun LinearPropertyPill(
  /** "Status High", for TalkBack. */
  description: String,
  enabled: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  label: @Composable RowScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  val interaction = rememberInteraction()
  val shape = RoundedCornerShape(7.dp)
  Row(
    modifier.fillMaxWidth()
      .heightIn(min = 40.dp)
      .argusClickable(interaction, enabled, shape, label = description, onClick = onClick)
      .background(if (interaction.pressed) theme.selection else Color.Transparent, shape)
      .padding(horizontal = 7.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    label()
    Box(Modifier.weight(1f))
    Icon(Icon.chevronDown, null, Modifier.size(16.dp), tint = theme.textMuted)
  }
}

/** The values sheet: a search, the options with the current one ticked, and an optional footer. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LinearPropertyMenuSheet(
  options: List<LinearIssueProperty.Option>,
  current: String,
  placeholder: String,
  icon: @Composable (String) -> Unit,
  onPick: (String) -> Unit,
  onDismiss: () -> Unit,
  footer: (@Composable () -> Unit)? = null,
) {
  val theme = ArgusTheme.colors
  val menu = remember(options) { LinearPropertyMenu(options).also { it.highlight(current) } }
  val query by menu.query.collectAsState()
  ModalBottomSheet(onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = theme.bg, contentColor = theme.text) {
    Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) {
      ThemedTextField(
        query, menu::setQuery, placeholder, Modifier.padding(horizontal = 16.dp, vertical = 8.dp), input = TextInput.Code,
        onSubmit = { menu.submission?.let { onDismiss(); onPick(it.id) } },
      )
      Column(Modifier.padding(horizontal = 8.dp)) {
        val visible = menu.visible
        for (option in visible) {
          MenuRow(option.title, role = Role.RadioButton, selected = option.id == current, onClick = { onDismiss(); onPick(option.id) }) {
            Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) { icon(option.id) }
            Text(option.title, Modifier.weight(1f), color = theme.text, style = argusFont(15), maxLines = 1)
            if (option.id == current) Icon(Icon.check, "Current", Modifier.size(16.dp), tint = theme.text)
          }
        }
        if (visible.isEmpty()) MenuNote("No matches")
        if (footer != null) {
          MenuDivider()
          footer()
        }
      }
    }
  }
}

/** "Time in status": each status the issue has been in, with how long, the current one emphasized. */
@Composable
fun LinearTimeInStatus(issue: LinearIssueDetail, states: List<LinearWorkflowState>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val history = issue.statusHistory.orEmpty().ifEmpty { listOf(LinearIssueDetailStatusHistoryItem(issue.state.name, issue.state.type, issue.createdAt)) }
  Column(modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
    Text("Time in status", Modifier.padding(bottom = 4.dp), color = theme.text, style = argusFont(13, FontWeight.Medium))
    for (stint in LinearIssueProperty.timeInStatus(history)) {
      val isCurrent = stint.name == issue.state.name
      Row(Modifier.heightIn(min = 28.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        IssueStatusGlyph(stint.type, color = states.firstOrNull { it.name == stint.name }?.color)
        Text(
          stint.name, Modifier.weight(1f), color = if (isCurrent) theme.text else theme.textMuted,
          style = argusFont(13, if (isCurrent) FontWeight.Medium else FontWeight.Normal), maxLines = 1,
        )
        Text(LinearIssueProperty.shortDuration(stint.duration), color = theme.textMuted, style = argusFont(13))
      }
    }
  }
}
