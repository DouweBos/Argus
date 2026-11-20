package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTaskStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChild
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock
import dev.houwert.argus.kit.util.ArtifactLink
import dev.houwert.argus.kit.util.DiffLine
import dev.houwert.argus.kit.util.InlineDiff
import dev.houwert.argus.kit.util.PendingForm
import dev.houwert.argus.kit.util.Questions
import dev.houwert.argus.kit.util.SecretRequest
import dev.houwert.argus.kit.util.ToolCallSummary
import dev.houwert.argus.kit.util.ToolGroups
import dev.houwert.argus.kit.util.ToolInput
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

private const val RESULT_PREVIEW_CHARS = 500

/**
 * One tool call, collapsed to a single line until you ask for more. A call awaiting a decision can
 * never be collapsed away: the decision is the whole point of the row.
 */
@Composable
fun ToolCallCard(call: RemoteToolCall, depth: Int = 0, modifier: Modifier = Modifier) {
  when {
    ToolGroups.isPushNotification(call) -> PushNotificationCard(call)
    else -> {
      val artifact = remember(call) { ArtifactLink.from(call) }
      if (artifact != null) ArtifactCard(artifact, call) else ToolCard(call, depth, modifier)
    }
  }
}

@Composable
private fun ToolCard(call: RemoteToolCall, depth: Int, modifier: Modifier) {
  val env = transcriptEnvironment
  val pending = LocalPending.current
  val theme = ArgusTheme.colors
  val isPending = pending.isPending(call)
  val resultImageIds = remember(call) {
    call.resultBlocks.filterIsInstance<RemoteToolResultBlock.Image>().map { it.value.imageId }
  }
  val autoExpanded = env.autoExpandImageReads && call.name == "Read" && resultImageIds.isNotEmpty()
  val userExpanded = env.toolExpansion[call.id]
  val expanded = isPending || pending.hasPendingCall(call) || (userExpanded ?: autoExpanded)
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  val border = when {
    isPending -> theme.warning.copy(alpha = 0.6f)
    call.isError == true || call.status == RemoteToolCallStatus.error -> theme.error.copy(alpha = 0.6f)
    else -> theme.borderSubtle
  }
  var showingPlan by remember { mutableStateOf(false) }
  val diffLines = remember(call) { inlineDiffLines(call) }

  Column(
    modifier.fillMaxWidth()
      .clip(shape)
      .background(theme.bgTertiary.copy(alpha = theme.bgTertiary.alpha * if (depth > 0) 0.6f else 1f))
      .border(1.dp, border, shape)
      .padding(9.dp),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Header(call, isPending, expanded) { if (!isPending) env.toolExpansion[call.id] = !expanded }
    if (expanded) {
      ExpandedBody(call, depth, isPending, diffLines, resultImageIds) { showingPlan = true }
    } else if (diffLines != null) {
      DiffLinesView(diffLines)
    } else if (ToolCallSummary.isSubagent(call.name)) {
      val preview = remember(call) { ToolCallSummary.subagentPreview(call) }
      if (preview.calls.isNotEmpty()) SubagentPreview(preview.calls, preview.earlier) { env.toolExpansion[call.id] = true }
    }
  }
  if (showingPlan) PlanFullScreen(call.input["plan"].stringValue.orEmpty(), onDismiss = { showingPlan = false })
}

@Composable
private fun Header(call: RemoteToolCall, isPending: Boolean, expanded: Boolean, onToggle: () -> Unit) {
  val theme = ArgusTheme.colors
  val working = call.background?.let { it.status == RemoteBackgroundTaskStatus.running }
    ?: (call.status == RemoteToolCallStatus.running && ToolCallSummary.isSubagent(call.name))
  val displayName = ToolCallSummary.label(call.name, call.input)
  // The type is already the name, so an Agent call's summary is just its task.
  val summary = call.input["description"].stringValue?.takeIf { call.name == "Agent" && it.isNotEmpty() }
    ?: ToolCallSummary.summary(call.name, call.input)
  Row(
    Modifier.fillMaxWidth().argusClickable(rememberInteraction(), enabled = !isPending, label = if (expanded) "Collapse" else "Expand", onClick = onToggle),
    horizontalArrangement = Arrangement.spacedBy(6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (working) {
      CircularProgressIndicator(Modifier.size(10.dp), color = theme.textMuted, strokeWidth = 1.5.dp)
    } else {
      Icon(if (expanded) Icon.chevronDown else Icon.chevronRight, null, Modifier.size(12.dp), tint = theme.textMuted)
    }
    Text(displayName, color = theme.text, style = argusFont(12, FontWeight.SemiBold), maxLines = 1, softWrap = false)
    MonoText(summary, Modifier.weight(1f), size = 11, maxLines = 1, truncateHead = ToolCallSummary.isPathTool(call.name))
    EditStats(call)
    if (isPending) Badge(if (SecretRequest.isTool(call.name)) "needs you" else "needs approval", tone = Tone.Warning)
    if (call.expired == true) Badge("not answered")
    if (call.isError == true) Badge("error", tone = Tone.Danger)
    val background = call.background
    if (background != null) {
      BackgroundTaskStatus(background)
    } else if (call.status == RemoteToolCallStatus.running && !isPending) {
      Badge("running", tone = Tone.Accent)
    }
  }
}

@Composable
private fun EditStats(call: RemoteToolCall) {
  val theme = ArgusTheme.colors
  val stats = remember(call) {
    when (call.name) {
      "Edit" -> {
        val old = call.input["old_string"].stringValue
        val new = call.input["new_string"].stringValue
        if (old != null && new != null) InlineDiff.stats(old, new) else null
      }
      "Write" -> call.input["content"].stringValue?.let(InlineDiff::writeStats)
      else -> null
    }
  } ?: return
  if (stats.additions > 0) Text("+${stats.additions}", color = theme.success, style = argusFont(10, mono = true))
  if (stats.deletions > 0) Text("-${stats.deletions}", color = theme.error, style = argusFont(10, mono = true))
}

private fun inlineDiffLines(call: RemoteToolCall): List<DiffLine>? = when (call.name) {
  "Edit" -> {
    val old = call.input["old_string"].stringValue
    val new = call.input["new_string"].stringValue
    if (old != null && new != null) InlineDiff.compute(old, new) else null
  }
  "Write" -> call.input["content"].stringValue?.let(InlineDiff::writeLines)
  else -> null
}

/** The answer text an AskUserQuestion came back with, once it has one. */
private fun answeredQuestions(call: RemoteToolCall, isPending: Boolean): Pair<List<Questions.Question>, String>? {
  if (call.name != "AskUserQuestion" || isPending || call.expired == true) return null
  val questions = Questions.parse(call.input) ?: return null
  val answer = call.resultBlocks.filterIsInstance<RemoteToolResultBlock.Text>().joinToString("\n") { it.value.text }
  return if (answer.isEmpty()) null else questions to answer
}

@Composable
private fun ExpandedBody(
  call: RemoteToolCall,
  depth: Int,
  isPending: Boolean,
  diffLines: List<DiffLine>?,
  resultImageIds: List<String>,
  onShowPlan: () -> Unit,
) {
  val theme = ArgusTheme.colors
  val pending = LocalPending.current
  val answered = remember(call, isPending) { answeredQuestions(call, isPending) }
  // The form below a pending call already shows its questions or plan.
  val formOwnsInput = isPending && PendingForm.of(call.name, call.input).ownsInput
  if (!formOwnsInput) {
    val plan = call.input["plan"].stringValue
    when {
      diffLines != null -> DiffLinesView(diffLines)
      call.name == "ExitPlanMode" && plan != null ->
        Box(Modifier.fillMaxWidth()) {
          MarkdownView(plan, Modifier.fillMaxWidth().padding(end = 40.dp), baseSize = 13)
          PlanExpandButton(Modifier.align(Alignment.TopEnd), onShowPlan)
        }
      answered != null -> AnsweredQuestionsView(answered.first, answered.second)
      call.name == "Bash" && call.input["command"].stringValue != null ->
        MonoText(call.input["command"].stringValue.orEmpty(), size = 11)
      else -> ToolInputFieldsView(remember(call) { ToolInput.fields(call.input) })
    }
  }
  // The answer view already shows what came back; an expired prompt's result only repeats its badge.
  if (call.resultBlocks.isNotEmpty() && answered == null && call.expired != true) {
    for (block in call.resultBlocks) {
      when (block) {
        is RemoteToolResultBlock.Text -> {
          val text = block.value.text
          val clipped = if (text.length > RESULT_PREVIEW_CHARS) text.take(RESULT_PREVIEW_CHARS) + "…" else text
          Text(
            clipped, color = if (call.isError == true) theme.error else theme.textSecondary,
            style = argusFont(11, mono = true), overflow = TextOverflow.Clip,
          )
        }
        is RemoteToolResultBlock.Image -> TranscriptImage(block.value.imageId, siblings = resultImageIds, maxHeight = 220.dp)
        is RemoteToolResultBlock.Unknown -> Unit
      }
    }
  }
  val children = call.children
  if (!children.isNullOrEmpty() && depth < 3) {
    Text("Sub-agent activity", color = theme.textMuted, style = argusFont(10, FontWeight.Bold))
    for (child in children) {
      when (child) {
        is RemoteToolCallChild.Text -> MutedText(child.value.text)
        is RemoteToolCallChild.ToolUse -> {
          val nested = child.value.toolCall
          ToolCallCard(nested, depth + 1)
          if (pending.isPending(nested)) PendingCallForm(nested)
        }
        is RemoteToolCallChild.Unknown -> Unit
      }
    }
  }
}
