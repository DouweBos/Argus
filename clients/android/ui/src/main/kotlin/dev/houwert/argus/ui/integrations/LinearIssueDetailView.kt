package dev.houwert.argus.ui.integrations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.FigmaLink
import dev.houwert.argus.core.stores.LinearIssueActivity
import dev.houwert.argus.core.stores.LinearIssueDetailModel
import dev.houwert.argus.core.stores.summary
import dev.houwert.argus.kit.protocol.generated.LinearAttachment
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailRelationsItem
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.BrandIcons
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/**
 * The whole ticket the way Linear shows it: title, properties, description, sub-issues,
 * relations, resources and one activity timeline. With `canEdit`, change its status and
 * priority, comment and reply.
 */
@Composable
fun LinearIssueDetailView(
  model: LinearIssueDetailModel,
  canEdit: Boolean,
  /** False greys out "Start agent": no project, or no control. */
  canStart: Boolean,
  /** The session already working on the issue, if any. */
  sessionOnIt: RemoteSession?,
  onOpenSession: (RemoteSession) -> Unit,
  onStart: (LinearIssue) -> Unit,
  modifier: Modifier = Modifier,
  /** Another issue by identifier: a sub-issue, a relation or the parent. */
  onOpenIssue: ((String) -> Unit)? = null,
  /** Figma links open here instead of the browser. */
  onOpenDesign: ((String) -> Unit)? = null,
) {
  val issue by model.issue.collectAsState()
  val loadError by model.loadError.collectAsState()
  LaunchedEffect(model.ref) { model.load() }
  val loaded = issue
  when {
    loaded != null -> IssueBody(model, loaded, canEdit, canStart, sessionOnIt, onOpenSession, onStart, onOpenIssue, onOpenDesign, modifier)
    loadError != null -> EmptyState(Icon.warning, "Couldn't load the issue", modifier, body = loadError, selectable = true)
    else -> Box(modifier.fillMaxSize().padding(top = 48.dp), contentAlignment = Alignment.TopCenter) { Loading("Asking Linear") }
  }
}

@Composable
private fun IssueBody(
  model: LinearIssueDetailModel,
  issue: LinearIssueDetail,
  canEdit: Boolean,
  canStart: Boolean,
  sessionOnIt: RemoteSession?,
  onOpenSession: (RemoteSession) -> Unit,
  onStart: (LinearIssue) -> Unit,
  onOpenIssue: ((String) -> Unit)?,
  onOpenDesign: ((String) -> Unit)?,
  modifier: Modifier,
) {
  val theme = ArgusTheme.colors
  val uri = LocalUriHandler.current
  val scope = rememberCoroutineScope()
  val actionError by model.actionError.collectAsState()
  val updating by model.updating.collectAsState()
  val posting by model.posting.collectAsState()
  val postingIn by model.postingIn.collectAsState()
  val states by model.states.collectAsState()
  val onLink: (String) -> Unit = { url ->
    if (onOpenDesign != null && FigmaLink.isDesign(url)) onOpenDesign(url) else runCatching { uri.openUri(url) }
  }
  Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = ArgusMetrics.maxReadingWidth).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
      LinearIssueToolbar(issue)
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        issue.parent?.let { parent ->
          IssueLink(parent.identifier, onOpenIssue) { MutedText("Sub-issue of ${parent.identifier} · ${parent.title}", maxLines = 2) }
        }
        SelectionContainer { Text(issue.title, color = theme.text, style = argusFont(22, FontWeight.SemiBold)) }
      }
      Row {
        if (sessionOnIt != null) {
          Btn("Open session", small = true, icon = Icon.agent, hugs = true) { onOpenSession(sessionOnIt) }
        } else {
          Btn("Start agent", small = true, icon = Icon.play, hugs = true, enabled = canStart) { onStart(issue.summary()) }
        }
      }
      actionError?.let { Banner(it, tone = Tone.Danger, onDismiss = model::clearActionError) }
      LinearIssueProperties(
        issue, model.stateOptions, canEdit, updating,
        onSetState = { id -> scope.launch { model.setState(id) } },
        onSetPriority = { priority -> scope.launch { model.setPriority(priority) } },
      )
      if (issue.description.isBlank()) MutedText("No description.") else LinearMarkdown(issue.description, onLink)
      if (issue.children.isNotEmpty()) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
          SectionHeader("Sub-issues", count = issue.children.size)
          for (child in issue.children) {
            key(child.identifier) {
              IssueLink(child.identifier, onOpenIssue, "${child.identifier}, ${child.title}, ${child.state.name}") {
                LinearIssueLine(child.identifier, child.title, child.state.type, states.firstOrNull { it.name == child.state.name }?.color)
              }
            }
          }
        }
      }
      issue.relations?.takeIf { it.isNotEmpty() }?.let { LinearIssueRelations(it, onOpenIssue) }
      if (issue.attachments.isNotEmpty()) LinearIssueResources(issue.attachments, onLink)
      Box(Modifier.fillMaxWidth().height(1.dp).background(theme.borderSubtle))
      LinearIssueActivityView(issue, canEdit, posting, postingIn, onComment = { body, parent -> model.comment(body, parent) }, onLink = onLink)
    }
  }
}

@Composable
private fun IssueLink(identifier: String, onOpen: ((String) -> Unit)?, description: String? = null, content: @Composable () -> Unit) {
  if (onOpen == null) return content()
  val interaction = rememberInteraction()
  Box(
    Modifier.fillMaxWidth()
      .argusClickable(interaction, shape = RoundedCornerShape(6.dp), label = "Open $identifier") { onOpen(identifier) }
      .then(if (description != null) Modifier.semantics(mergeDescendants = true) { contentDescription = description } else Modifier)
  ) { content() }
}

/** One issue on a line: status, identifier, title. */
@Composable
fun LinearIssueLine(identifier: String, title: String, stateType: String, stateColor: String? = null, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Row(modifier.fillMaxWidth().heightIn(min = 36.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
    IssueStatusGlyph(stateType, color = stateColor, size = 12.dp)
    Text(identifier, color = theme.textMuted, style = argusFont(12, mono = true))
    Text(title, Modifier.weight(1f), color = theme.text, style = argusFont(13), maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/** Related issues, a group per kind of relation. */
@Composable
fun LinearIssueRelations(relations: List<LinearIssueDetailRelationsItem>, onOpen: ((String) -> Unit)?, modifier: Modifier = Modifier) {
  Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    for (group in LinearIssueActivity.relationGroups(relations)) {
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        SectionHeader(group.title, count = group.issues.size)
        for (related in group.issues) {
          IssueLink(related.identifier, onOpen, "${related.identifier}, ${related.title}, ${related.state.name}") {
            LinearIssueLine(related.identifier, related.title, related.state.type)
          }
        }
      }
    }
  }
}

/** Pull requests, commits and links on the issue: Linear's Resources. */
@Composable
fun LinearIssueResources(attachments: List<LinearAttachment>, onLink: (String) -> Unit, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    SectionHeader("Resources", count = attachments.size)
    for (attachment in attachments) {
      val interaction = rememberInteraction()
      Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp)
          .argusClickable(interaction, shape = RoundedCornerShape(6.dp), label = "Open ${attachment.title}") { onLink(attachment.url) },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(if (attachment.sourceType == "github") BrandIcons.github else Icon.link, null, Modifier.size(14.dp), tint = theme.textMuted)
        Text(attachment.title, Modifier.weight(1f, fill = false), color = theme.text, style = argusFont(13), maxLines = 1, overflow = TextOverflow.Ellipsis)
        attachment.subtitle?.let { Text(it, Modifier.weight(1f, fill = false), color = theme.textMuted, style = argusFont(12, mono = true), maxLines = 1) }
        Box(Modifier.weight(0.01f))
        attachment.createdAt?.let { Text(Labels.timeAgo(it), color = theme.textMuted, style = argusFont(12)) }
      }
    }
  }
}
