package dev.houwert.argus.ui.transcript

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.houwert.argus.kit.protocol.generated.RemoteTaskStatus
import dev.houwert.argus.kit.util.Questions
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.icons.checkboxOff
import dev.houwert.argus.ui.icons.checkboxOn
import dev.houwert.argus.ui.icons.radioOff
import dev.houwert.argus.ui.icons.radioOn
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** Answers to a plan: approve, keep planning, send feedback, or approve into a new session (absent with no repo). */
class PlanAnswers(
  val onApprove: () -> Unit,
  val onKeepPlanning: () -> Unit,
  val onFeedback: (String) -> Unit,
  val onApproveInNewSession: (() -> Unit)? = null,
)

/** Approve a plan, or send it back with feedback. */
@Composable
fun PlanApprovalView(plan: String, answers: PlanAnswers, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  var feedback by rememberSaveable { mutableStateOf("") }
  var fullScreen by remember { mutableStateOf(false) }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(ArgusMetrics.radiusSmall)).background(theme.bgTertiary)) {
      Box(Modifier.fillMaxWidth().heightIn(max = 280.dp).verticalScroll(rememberScrollState()).padding(10.dp)) {
        MarkdownView(plan, Modifier.padding(end = 36.dp), baseSize = 14)
      }
      PlanExpandButton(Modifier.align(Alignment.TopEnd)) { fullScreen = true }
    }
    PlanActions(feedback, { feedback = it }, answers)
  }
  if (fullScreen) {
    PlanFullScreen(plan, onDismiss = { fullScreen = false }, feedback = feedback, onFeedbackChange = { feedback = it }, answers = answers)
  }
}

/** Opens the plan full screen; carries its own backing to stay legible over the clamped plan's text. */
@Composable
fun PlanExpandButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  Box(
    modifier.padding(6.dp).clip(CircleShape)
      .background(theme.bgSecondary.copy(alpha = 0.9f))
      .border(1.dp, theme.borderSubtle, CircleShape),
  ) {
    IconBtn(Icon.expand, "View full plan", Modifier.size(32.dp), size = 14.dp, onClick = onClick)
  }
}

/** The feedback field and decision buttons, shared by the inline card and the full-screen plan so both edit one draft. */
@Composable
private fun PlanActions(feedback: String, onFeedbackChange: (String) -> Unit, answers: PlanAnswers, before: () -> Unit = {}) {
  var confirmingHandoff by remember { mutableStateOf(false) }
  val trimmed = feedback.trim()
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    ThemedTextField(feedback, onFeedbackChange, "Feedback (optional)", multiline = true)
    // One row when it fits, a full-width column when it doesn't (a phone).
    BoxWithConstraints {
      val wide = maxWidth > 520.dp
      val buttons: @Composable (Modifier) -> Unit = { m ->
        Btn("Approve", m, small = true, hugs = wide) { before(); answers.onApprove() }
        // The second button changes meaning once there is something to send.
        if (trimmed.isEmpty()) {
          Btn("Keep planning", m, tone = ButtonTone.Ghost, small = true) { before(); answers.onKeepPlanning() }
        } else {
          Btn("Send feedback", m, tone = ButtonTone.Secondary, small = true, hugs = wide) { before(); answers.onFeedback(trimmed) }
        }
        if (answers.onApproveInNewSession != null) {
          Btn("Approve in new session", m, tone = ButtonTone.Secondary, small = true, hugs = wide) { confirmingHandoff = true }
        }
      }
      if (wide) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { buttons(Modifier) }
      } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { buttons(Modifier.fillMaxWidth()) }
      }
    }
  }
  if (confirmingHandoff) {
    ConfirmDialog(
      title = "Implement in a new session?",
      message = "Argus starts a new session on this plan. This one stays in plan mode.",
      confirm = "Create",
      onConfirm = {
        before()
        answers.onApproveInNewSession?.invoke()
      },
      onDismiss = { confirmingHandoff = false },
    )
  }
}

/** A two-button confirmation in the app's colours. */
@Composable
internal fun ConfirmDialog(
  title: String,
  message: String?,
  confirm: String,
  onConfirm: () -> Unit,
  onDismiss: () -> Unit,
  destructive: Boolean = false,
) {
  val theme = ArgusTheme.colors
  AlertDialog(
    onDismissRequest = onDismiss,
    containerColor = theme.bgSecondary,
    titleContentColor = theme.text,
    textContentColor = theme.textSecondary,
    title = { Text(title, style = ArgusTheme.typography.headline) },
    text = message?.let { { Text(it, style = ArgusTheme.typography.subheadline) } },
    confirmButton = {
      TextButton({ onDismiss(); onConfirm() }) {
        Text(confirm, color = if (destructive) theme.error else theme.accent, style = argusFont(15, FontWeight.SemiBold))
      }
    },
    dismissButton = { TextButton(onDismiss) { Text("Cancel", color = theme.accent, style = argusFont(15)) } },
  )
}

/**
 * The plan at full size: a plan is many screens long on a phone, and the clamped box is a keyhole.
 * Without [answers] (an answered plan) it's read-only; answering closes it first, so the card below resolves on screen.
 */
@Composable
fun PlanFullScreen(
  plan: String,
  onDismiss: () -> Unit,
  feedback: String = "",
  onFeedbackChange: (String) -> Unit = {},
  answers: PlanAnswers? = null,
) {
  val theme = ArgusTheme.colors
  Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Column(Modifier.fillMaxSize().background(theme.bg).statusBarsPadding().navigationBarsPadding().imePadding()) {
      Box(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text("Plan", color = theme.text, style = ArgusTheme.typography.headline)
        IconBtn(Icon.close, "Close", Modifier.align(Alignment.CenterEnd), onClick = onDismiss)
      }
      Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
        MarkdownView(plan, Modifier.fillMaxWidth(), baseSize = 15)
      }
      if (answers != null) {
        Column(Modifier.fillMaxWidth().background(theme.bgSecondary)) {
          Spacer(Modifier.fillMaxWidth().height(1.dp).background(theme.border))
          Box(Modifier.padding(16.dp)) { PlanActions(feedback, onFeedbackChange, answers, before = onDismiss) }
        }
      }
    }
  }
}

/** The inline AskUserQuestion form. */
@Composable
fun QuestionFormView(
  questions: List<Questions.Question>,
  onSubmit: (String) -> Unit,
  onCancel: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  val picks = remember(questions) { mutableStateMapOf<Int, List<String>>() }
  val custom = remember(questions) { mutableStateMapOf<Int, String>() }
  val allAnswered = questions.indices.all { index ->
    val chosen = picks[index].orEmpty()
    when {
      chosen.isEmpty() -> false
      // A custom pick with nothing typed into it isn't an answer.
      Questions.CUSTOM_KEY in chosen -> custom[index].orEmpty().isNotBlank() || chosen.size > 1
      else -> true
    }
  }
  fun toggle(index: Int, question: Questions.Question, label: String) {
    val chosen = picks[index].orEmpty()
    picks[index] =
      if (question.multiSelect) {
        if (label in chosen) chosen - label else chosen + label
      } else {
        // Re-tapping the current choice clears it.
        if (chosen == listOf(label)) emptyList() else listOf(label)
      }
  }
  Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
    questions.forEachIndexed { index, question ->
      Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(question.header ?: "Question ${index + 1}", color = theme.textMuted, style = argusFont(11, FontWeight.Bold))
        BodyText(question.question)
        val chosen = picks[index].orEmpty()
        for (option in question.options) {
          OptionRow(option.label, option.description, option.label in chosen, question.multiSelect) { toggle(index, question, option.label) }
        }
        OptionRow("Type your own answer", null, Questions.CUSTOM_KEY in chosen, question.multiSelect) {
          toggle(index, question, Questions.CUSTOM_KEY)
        }
        if (Questions.CUSTOM_KEY in chosen) {
          ThemedTextField(custom[index].orEmpty(), { custom[index] = it }, "Your answer")
        }
      }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Btn("Submit", Modifier.weight(1f), small = true, fills = true, enabled = allAnswered) {
        onSubmit(Questions.formatAnswer(questions, picks.toMap(), custom.toMap()))
      }
      Btn("Cancel", Modifier.weight(1f), tone = ButtonTone.Secondary, small = true, fills = true, onClick = onCancel)
    }
  }
}

@Composable
private fun OptionRow(label: String, description: String?, selected: Boolean, multi: Boolean, onClick: () -> Unit) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall)
  Row(
    Modifier.fillMaxWidth()
      .argusClickable(rememberInteraction(), shape = shape, role = if (multi) Role.Checkbox else Role.RadioButton, label = label, onClick = onClick)
      .background(if (selected) theme.accentSoft else theme.bgTertiary)
      .border(1.dp, if (selected) theme.accentBorder else androidx.compose.ui.graphics.Color.Transparent, shape)
      .padding(9.dp),
    horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    val icon = if (multi) (if (selected) Icon.checkboxOn else Icon.checkboxOff) else (if (selected) Icon.radioOn else Icon.radioOff)
    Icon(icon, null, Modifier.size(18.dp), tint = if (selected) theme.accent else theme.textMuted)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(label, color = theme.text, style = argusFont(14))
      if (description != null) Text(description, color = theme.textMuted, style = argusFont(12))
    }
  }
}

/** Allow / Deny for an ordinary tool prompt, with "Always Allow <rule>" where the client can send one. */
@Composable
fun PermissionButtons(
  onAllow: () -> Unit,
  onDeny: () -> Unit,
  modifier: Modifier = Modifier,
  alwaysAllow: Pair<String, () -> Unit>? = null,
) {
  FlowRow(modifier, packed = true) {
    Btn("Allow", small = true, hugs = true, onClick = onAllow)
    if (alwaysAllow != null) Btn("Always Allow ${alwaysAllow.first}", tone = ButtonTone.Secondary, small = true, hugs = true, onClick = alwaysAllow.second)
    Btn("Deny", tone = ButtonTone.Danger, small = true, hugs = true, onClick = onDeny)
  }
}

/** One line of a task or todo list. */
data class TaskListItem(val text: String, val status: RemoteTaskStatus, val owner: String? = null)

/** The agent's tasks or todos, under the turn: what it's doing, with a done count. */
@Composable
fun TaskListView(title: String, items: List<TaskListItem>, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Card(modifier) {
    Text(
      "$title · ${items.count { it.status == RemoteTaskStatus.completed }} done", color = theme.textMuted,
      style = argusFont(11, FontWeight.Bold),
    )
    for (item in items) {
      val done = item.status == RemoteTaskStatus.completed
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(14.dp, 18.dp), contentAlignment = Alignment.Center) {
          when (item.status) {
            RemoteTaskStatus.completed -> Icon(Icon.check, "Done", Modifier.size(13.dp), tint = theme.success)
            RemoteTaskStatus.inProgress -> StatusDot(Tone.Accent, pulse = true, contentDescription = "In progress")
            else -> StatusDot(Tone.Muted, contentDescription = "Pending")
          }
        }
        Text(
          item.text, Modifier.weight(1f), color = if (done) theme.textMuted else theme.text,
          style = argusFont(14).copy(textDecoration = if (done) TextDecoration.LineThrough else null),
        )
        if (!item.owner.isNullOrEmpty()) Badge(item.owner)
      }
    }
  }
}
