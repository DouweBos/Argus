package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.LinearIssueBoard
import dev.houwert.argus.core.stores.LinearIssueProperty
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.ui.components.ContextCardDivider
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.card
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.delay

/** The issue's identifier and Linear's copy link / ID / branch and open buttons. */
@Composable
fun LinearIssueToolbar(issue: LinearIssueDetail, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val clipboard = LocalClipboardManager.current
  val uri = LocalUriHandler.current
  var copied by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(copied) {
    if (copied != null) {
      delay(2_000)
      copied = null
    }
  }
  Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Text(issue.identifier, color = theme.textMuted, style = argusFont(12, mono = true))
    copied?.let { Text(it, Modifier.padding(start = 8.dp), color = theme.textMuted, style = argusFont(12)) }
    Box(Modifier.weight(1f))
    fun copy(value: String, done: String) {
      clipboard.setText(AnnotatedString(value))
      copied = done
    }
    IconBtn(Icon.link, "Copy link", size = 18.dp) { copy(issue.url, "Link copied") }
    IconBtn(IntegrationIcon.number, "Copy ID", size = 18.dp) { copy(issue.identifier, "ID copied") }
    IconBtn(Icon.branch, "Copy branch name", size = 18.dp) { copy(issue.branchName, "Branch copied") }
    IconBtn(Icon.openExternal, "Open in Linear", size = 18.dp) { runCatching { uri.openUri(issue.url) } }
  }
}

/**
 * Linear's Properties in a card: status and priority as menus when they may be changed, then the
 * rest — assignee, team, estimate, cycle, due date, project and labels.
 */
@Composable
fun LinearIssueProperties(
  issue: LinearIssueDetail,
  stateOptions: List<LinearWorkflowState>,
  canEdit: Boolean,
  updating: Boolean,
  onSetState: (String) -> Unit,
  onSetPriority: (Int) -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  var open by remember { mutableStateOf<LinearIssueProperty.Kind?>(null) }
  val priorityLabel = LinearIssueBoard.priorityLabel(issue.priority.toInt())
  Column(modifier.fillMaxWidth().card(padding = 5.dp)) {
    if (canEdit) {
      LinearPropertyPill("Status ${issue.state.name}", !updating, { open = LinearIssueProperty.Kind.Status }) {
        IssueStatusGlyph(issue.state.type, Modifier.width(16.dp), color = issue.state.color)
        Value(issue.state.name)
      }
      LinearPropertyPill("Priority $priorityLabel", !updating, { open = LinearIssueProperty.Kind.Priority }) {
        PriorityGlyph(issue.priority, Modifier.width(16.dp))
        Value(priorityLabel)
      }
    } else {
      PropertyRow("Status ${issue.state.name}") {
        IssueStatusGlyph(issue.state.type, Modifier.width(16.dp), color = issue.state.color)
        Value(issue.state.name)
      }
      PropertyRow("Priority $priorityLabel") {
        PriorityGlyph(issue.priority, Modifier.width(16.dp))
        Value(priorityLabel)
      }
    }
    val assignee = issue.assignee
    PropertyRow(assignee?.let { "Assigned to $it" } ?: "Unassigned") {
      if (assignee != null) {
        LinearAvatar(assignee, url = issue.assigneeAvatarUrl, size = 16.dp)
        Value(assignee)
      } else {
        PropertyIcon(Icon.person)
        Muted("Unassigned")
      }
    }
    PropertyRow("Team ${issue.teamName}") {
      PropertyIcon(IntegrationIcon.team)
      Value(issue.teamName)
    }
    issue.estimate?.let { estimate ->
      val label = LinearIssueBoard.estimateLabel(estimate, issue.estimateType)
      PropertyRow("Estimate $label") {
        PropertyIcon(IntegrationIcon.estimate)
        Value(label)
      }
    }
    issue.cycle?.let { cycle ->
      val label = LinearIssueBoard.cycleLabel(cycle.number, cycle.name)
      PropertyRow("Cycle $label") {
        PropertyIcon(IntegrationIcon.cycle)
        Value(label)
        if (cycle.isActive) Muted("current")
      }
    }
    issue.dueDate?.let { due ->
      PropertyRow("Due $due") {
        PropertyIcon(IntegrationIcon.due)
        Value("Due $due")
      }
    }
    ContextCardDivider()
    PropertyRow(issue.project?.let { "Project ${it.name}" } ?: "No project") {
      PropertyIcon(IntegrationIcon.project)
      issue.project?.let { Value(it.name) } ?: Muted("No project")
    }
    if (issue.labels.isEmpty()) {
      PropertyRow("No labels") {
        PropertyIcon(IntegrationIcon.label)
        Muted("No labels")
      }
    } else {
      FlowRow(Modifier.padding(horizontal = 7.dp, vertical = 4.dp), spacing = 4.dp, rowSpacing = 4.dp, packed = true) {
        for (label in issue.labels) LinearLabelChip(label, issue.labelColors?.firstOrNull { it.name == label }?.color)
      }
    }
  }
  when (open) {
    LinearIssueProperty.Kind.Status ->
      LinearPropertyMenuSheet(
        LinearIssueProperty.statusOptions(stateOptions), issue.state.id, "Change status",
        icon = { id -> stateOptions.firstOrNull { it.id == id }.let { IssueStatusGlyph(it?.type ?: "", color = it?.color) } },
        onPick = onSetState, onDismiss = { open = null },
        footer = { LinearTimeInStatus(issue, stateOptions) },
      )
    LinearIssueProperty.Kind.Priority ->
      LinearPropertyMenuSheet(
        LinearIssueProperty.priorityOptions, "${issue.priority.toInt()}", "Change priority",
        icon = { id -> PriorityGlyph(id.toIntOrNull() ?: 0) },
        onPick = { id -> id.toIntOrNull()?.let(onSetPriority) }, onDismiss = { open = null },
      )
    else -> Unit
  }
}

/** A label as Linear draws it: a pill with the label's own colour as a dot. */
@Composable
fun LinearLabelChip(name: String, hex: String?, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(
    modifier.border(1.dp, theme.border, CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.size(8.dp).background(linearColor(hex) ?: theme.textMuted, CircleShape))
    Text(name, color = theme.text, style = argusFont(12, FontWeight.Medium), maxLines = 1)
  }
}

/** A read-only card row, the same inset and height as the menus so they line up. */
@Composable
private fun PropertyRow(description: String, content: @Composable RowScope.() -> Unit) {
  Row(
    Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(horizontal = 7.dp).semantics(mergeDescendants = true) { contentDescription = description },
    horizontalArrangement = Arrangement.spacedBy(8.dp),
    verticalAlignment = Alignment.CenterVertically,
    content = content,
  )
}

@Composable
private fun PropertyIcon(icon: ImageVector) {
  Icon(icon, null, Modifier.size(16.dp), tint = ArgusTheme.colors.textMuted)
}

@Composable
private fun Value(text: String) {
  Text(text, color = ArgusTheme.colors.text, style = argusFont(13), maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
}

@Composable
private fun Muted(text: String) {
  Text(text, color = ArgusTheme.colors.textMuted, style = argusFont(13), maxLines = 1)
}
