package dev.houwert.argus.ui.inbox

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import dev.houwert.argus.kit.protocol.generated.RemoteProposal
import dev.houwert.argus.kit.protocol.generated.RemoteProposalStatus
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.components.AccentLink
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.ProjectBadge
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import androidx.compose.foundation.shape.RoundedCornerShape

/** What a proposal card shows. */
data class ProposalCardContent(
  val title: String,
  val summary: String,
  val rationale: String,
  val confidence: Double,
  val project: String?,
  /** The project's repo root, which colours its badge. */
  val projectKey: String?,
  val automationName: String?,
  val createdAt: Double,
  val cta: Cta?,
  val source: Source?,
  val revisionRequest: String?,
  val startStage: String?,
  val startError: String?,
  val isPending: Boolean,
) {
  sealed interface Cta {
    data class Start(val label: String) : Cta
    data class Cleanup(val label: String, val deletesSession: Boolean, val branch: String?, val force: Boolean) : Cta
    data class Open(val label: String, val url: String) : Cta
  }

  data class Source(val label: String, val url: String)

  /** "Delete this session?" or "Delete this branch?". */
  val cleanupTitle: String
    get() = if ((cta as? Cta.Cleanup)?.deletesSession == true) "Delete this session?" else "Delete this branch?"

  /** Spell out exactly what will happen — these are the destructive ones. */
  val cleanupWarning: String
    get() {
      val cleanup = cta as? Cta.Cleanup ?: return ""
      if (cleanup.deletesSession) return "The worktree and anything uncommitted in it are deleted. The branch is left alone."
      return "${if (cleanup.force) "git branch -D" else "git branch -d"} ${cleanup.branch ?: ""} — commits only on this branch are gone for good."
    }

  companion object {
    fun from(proposal: RemoteProposal, projectKey: String? = null) = ProposalCardContent(
      title = proposal.title,
      summary = proposal.summary,
      rationale = proposal.rationale,
      confidence = proposal.confidence,
      project = proposal.project,
      projectKey = projectKey,
      automationName = proposal.automationName,
      createdAt = proposal.createdAt,
      cta = proposal.cta?.let { cta(it.kind.rawValue, it.label, it.url, it.branch, it.force) },
      source = proposal.sourceUrl?.takeIf { it.isNotBlank() }?.let { Source(proposal.sourceLabel ?: "Source", it) },
      revisionRequest = proposal.revisionRequest,
      startStage = proposal.startStage?.rawValue,
      startError = proposal.startError,
      isPending = proposal.status == RemoteProposalStatus.pending,
    )

    fun cta(kind: String, label: String, url: String?, branch: String?, force: Boolean): Cta? = when (kind) {
      "start_session" -> Cta.Start(label)
      "delete_branch" -> Cta.Cleanup(label, deletesSession = false, branch = branch, force = force)
      "delete_session" -> Cta.Cleanup(label, deletesSession = true, branch = branch, force = force)
      else -> url?.takeIf { it.isNotBlank() }?.let { Cta.Open(label, it) }
    }
  }
}

/** Everything a proposal card can ask its owner to do. */
class ProposalCardActions(
  val start: (note: String?) -> Unit,
  val requestRevision: (note: String) -> Unit,
  val resolve: (note: String?) -> Unit,
  val dismiss: (reason: String?) -> Unit,
  val cleanup: () -> Unit,
  /** Null when nobody said which run raised it. */
  val openRun: (() -> Unit)? = null,
  /** The proposal's own page; null when the card already is it. */
  val openDetails: (() -> Unit)? = null,
)

/** The note a decision can carry, asked for in place of the card's footer. */
enum class ProposalCompose(val title: String, val placeholder: String, val confirm: String) {
  StartNote("Start with a note", "Anything the agent should know before it starts?", "Start"),
  Revise("Request a revision", "What should the automation do differently?", "Send"),
  Resolve("Mark as done", "What did you do? (optional)", "Done"),
  Dismiss("Dismiss", "Why? (optional)", "Dismiss");

  /** A revision is the one note that says nothing without its text. */
  val needsText: Boolean get() = this == Revise
}

/**
 * One proposal and everything you can do with it — start it (with or without a note), ask for
 * a better one, mark it done, dismiss it, follow its CTA. The note is asked for inline.
 */
@Composable
fun ProposalCard(
  content: ProposalCardContent,
  busy: Boolean,
  starting: Boolean,
  canDecide: Boolean,
  actions: ProposalCardActions,
  modifier: Modifier = Modifier,
  /** What became of it, once it can't be acted on any more. */
  decided: String? = null,
  /** The start request's own failure, which wins over the host's older one. */
  requestError: String? = null,
) {
  var compose by rememberSaveable { mutableStateOf<ProposalCompose?>(null) }
  var confirmingCleanup by rememberSaveable { mutableStateOf(false) }
  val startFailure = if (starting) null else requestError ?: content.startError
  val deciding = canDecide && content.isPending && !starting

  Card(modifier.alpha(if (busy) 0.5f else 1f).animateContentSize()) {
    ProposalHeader(content, actions.openDetails)
    SelectionContainer { BodyText(content.summary) }
    if (content.rationale.isNotEmpty()) MutedText(content.rationale)
    content.revisionRequest?.takeIf { it.isNotEmpty() }?.let { Banner(it, tone = Tone.Accent, title = "You asked for a revision") }
    if (decided != null) Banner(decided, tone = Tone.Muted)
    when {
      starting ->
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          CircularProgressIndicator(Modifier.size(14.dp), color = ArgusTheme.colors.textMuted, strokeWidth = 2.dp)
          MutedText(ProposalText.stage(content.startStage))
        }
      startFailure != null -> SelectionContainer { Banner(startFailure, tone = Tone.Danger, title = "Couldn't start") }
    }
    val mode = compose
    if (mode != null) {
      ProposalComposer(mode, onCancel = { compose = null }) { note ->
        compose = null
        when (mode) {
          ProposalCompose.StartNote -> actions.start(note)
          ProposalCompose.Revise -> actions.requestRevision(note ?: "")
          ProposalCompose.Resolve -> actions.resolve(note)
          ProposalCompose.Dismiss -> actions.dismiss(note)
        }
      }
    } else {
      Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (deciding) Decisions(content, startFailure, actions, onCompose = { compose = it }, onCleanup = { confirmingCleanup = true })
        Links(content, actions.openRun)
      }
    }
  }

  if (confirmingCleanup) {
    val label = (content.cta as? ProposalCardContent.Cta.Cleanup)?.label ?: "Run cleanup"
    AlertDialog(
      onDismissRequest = { confirmingCleanup = false },
      title = { Text(content.cleanupTitle) },
      text = { Text(content.cleanupWarning) },
      confirmButton = {
        TextButton(onClick = {
          confirmingCleanup = false
          actions.cleanup()
        }) { Text(label, color = ArgusTheme.colors.error) }
      },
      dismissButton = { TextButton(onClick = { confirmingCleanup = false }) { Text("Cancel") } },
      containerColor = ArgusTheme.colors.surface,
      titleContentColor = ArgusTheme.colors.text,
      textContentColor = ArgusTheme.colors.textSecondary,
    )
  }
}

@Composable
private fun ProposalHeader(content: ProposalCardContent, openDetails: (() -> Unit)?) {
  val theme = ArgusTheme.colors
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    val titleStyle = ArgusTheme.typography.headline
    if (openDetails != null) {
      val interaction = rememberInteraction()
      Text(
        content.title,
        Modifier.argusClickable(interaction, shape = RoundedCornerShape(4.dp), label = "Open the proposal", onClick = openDetails)
          .semantics { heading() },
        color = theme.text, style = titleStyle,
      )
    } else {
      SelectionContainer { Text(content.title, Modifier.semantics { heading() }, color = theme.text, style = titleStyle) }
    }
    FlowRow(spacing = 6.dp, rowSpacing = 6.dp, packed = true) {
      Badge(
        "${Math.round(content.confidence * 100)}% sure",
        tone = if (content.confidence >= 0.7) Tone.Success else Tone.Muted,
      )
      content.project?.let { project ->
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
          ProjectBadge(project, key = content.projectKey, size = 14.dp)
          Badge(project)
        }
      }
      content.automationName?.let { Badge(it) }
      MutedText(Labels.timeAgo(content.createdAt))
    }
  }
}

/** The CTA, done and dismiss as buttons; the two that need a note behind a menu, since five don't fit a phone. */
@Composable
private fun Decisions(
  content: ProposalCardContent,
  startFailure: String?,
  actions: ProposalCardActions,
  onCompose: (ProposalCompose) -> Unit,
  onCleanup: () -> Unit,
) {
  val uri = LocalUriHandler.current
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    FlowRow(Modifier.weight(1f), spacing = 8.dp, packed = true) {
      when (val cta = content.cta) {
        is ProposalCardContent.Cta.Start ->
          Btn(
            if (startFailure == null) cta.label else "Try again", small = true, hugs = true,
            icon = if (startFailure == null) Icon.play else Icon.refresh,
          ) { actions.start(null) }
        is ProposalCardContent.Cta.Cleanup -> Btn(cta.label, tone = ButtonTone.Danger, small = true, hugs = true, onClick = onCleanup)
        is ProposalCardContent.Cta.Open -> Btn(cta.label, tone = ButtonTone.Secondary, small = true, hugs = true) { uri.openUri(cta.url) }
        null -> Unit
      }
      Btn(
        "Mark as done", tone = if (content.cta == null) ButtonTone.Primary else ButtonTone.Secondary, small = true, hugs = true,
        icon = Icon.check,
      ) { onCompose(ProposalCompose.Resolve) }
      Btn("Dismiss", tone = ButtonTone.Ghost, small = true, hugs = true) { onCompose(ProposalCompose.Dismiss) }
    }
    var open by remember { mutableStateOf(false) }
    Box {
      IconBtn(Icon.ellipsis, "More decisions", size = 18.dp) { open = true }
      DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
        if (content.cta is ProposalCardContent.Cta.Start) {
          DropdownMenuItem(
            text = { Text("Start with a note") },
            leadingIcon = { Icon(Icon.play, null) },
            onClick = {
              open = false
              onCompose(ProposalCompose.StartNote)
            },
          )
        }
        DropdownMenuItem(
          text = { Text("Request a revision") },
          leadingIcon = { Icon(Icon.refresh, null) },
          onClick = {
            open = false
            onCompose(ProposalCompose.Revise)
          },
        )
      }
    }
  }
}

@Composable
private fun Links(content: ProposalCardContent, openRun: (() -> Unit)?) {
  val uri = LocalUriHandler.current
  if (openRun == null && content.source == null) return
  Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
    if (openRun != null) AccentLink("View run", onClick = openRun)
    content.source?.let { source -> AccentLink(source.label) { uri.openUri(source.url) } }
  }
}

/** The note, in place of the footer; the field and its buttons share a row so they rise with the keyboard together. */
@Composable
private fun ProposalComposer(mode: ProposalCompose, onCancel: () -> Unit, onSubmit: (String?) -> Unit) {
  var text by rememberSaveable(mode) { mutableStateOf("") }
  val focus = remember { FocusRequester() }
  LaunchedEffect(mode) { runCatching { focus.requestFocus() } }
  val note = text.trim()
  val submit = {
    if (!(mode.needsText && note.isEmpty())) onSubmit(note.ifEmpty { null })
  }
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    MutedText(mode.title)
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      ThemedTextField(
        text, { text = it }, mode.placeholder, Modifier.weight(1f).focusRequester(focus), multiline = true, lines = 1..4,
        input = TextInput.Prose,
      )
      Btn(mode.confirm, small = true, hugs = true, enabled = !(mode.needsText && note.isEmpty()), onClick = submit)
      IconBtn(Icon.close, "Cancel", Modifier.size(36.dp), size = 16.dp, onClick = onCancel)
    }
  }
}

/** A start from this phone that finished after the request answered: offer the way to the agent instead of vanishing. */
@Composable
fun StartedProposalCard(proposal: RemoteProposal, onOpen: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Card(modifier, tone = Tone.Success) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icon.check, null, Modifier.size(16.dp), tint = theme.success)
      Text("Agent started", Modifier.weight(1f), color = theme.text, style = argusFont(15, FontWeight.Medium))
      IconBtn(Icon.close, "Close", Modifier.size(32.dp), size = 14.dp, tint = theme.textMuted, onClick = onClose)
    }
    MutedText(proposal.title, maxLines = 2)
    Btn("Open agent", small = true, hugs = true, icon = Icon.agent, onClick = onOpen)
  }
}
