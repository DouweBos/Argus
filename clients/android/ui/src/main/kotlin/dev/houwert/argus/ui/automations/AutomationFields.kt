package dev.houwert.argus.ui.automations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.automations.AutomationAccountPin
import dev.houwert.argus.core.automations.Autonomy
import dev.houwert.argus.core.automations.autonomyRung
import dev.houwert.argus.core.automations.isAvailable
import dev.houwert.argus.core.automations.onceError
import dev.houwert.argus.core.automations.pickerHint
import dev.houwert.argus.core.automations.schedulePreviewText
import dev.houwert.argus.core.automations.withAutonomy
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSignalSource
import dev.houwert.argus.kit.util.OnceTime
import dev.houwert.argus.ui.components.BodyText
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.Field
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.MonoText
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.SegmentedControl
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.ToggleList
import dev.houwert.argus.ui.components.ToggleOption
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.argusFont
import java.io.File
import java.util.TimeZone

/** What the form needs from the computer, beyond the draft itself. */
data class AutomationFieldsContext(
  val sources: List<RemoteSignalSource> = emptyList(),
  /** Empty on a computer too old to answer `automations.runners`. */
  val runners: List<RemoteRunner> = emptyList(),
  val projects: List<RemoteProject> = emptyList(),
  val accounts: List<RemoteClaudeAccount> = emptyList(),
  val activeAccountId: String? = null,
  val hasControl: Boolean = false,
)

/**
 * The fields an automation and a quick run share: what it does, what it may read, how far it
 * may go, and the playbook. A quick run hides the trigger and the enabled switch
 * ([showsSchedule] false); everything else is the same form, because it is the same spec.
 * [revise] rewrites the playbook (null when the computer refused, with [reviseError] set).
 */
@Composable
fun AutomationFields(
  draft: RemoteAutomationDetail,
  onChange: (RemoteAutomationDetail) -> Unit,
  context: AutomationFieldsContext,
  modifier: Modifier = Modifier,
  showsSchedule: Boolean = true,
  reviseError: String? = null,
  revise: (suspend (instruction: String) -> String?)? = null,
) {
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(ArgusTheme.metrics.space)) {
    Basics(draft, onChange, showsSchedule)
    if (showsSchedule) Trigger(draft, onChange)
    Scope(draft, onChange, context)
    Behaviour(draft, onChange, context, showsSchedule)
    Playbook(draft, onChange, context.hasControl, reviseError, revise)
    if (showsSchedule) {
      Field("Extra instructions", caption = "Added after the playbook on every run; they win where the two disagree.") {
        ThemedTextField(
          draft.extraInstructions, { onChange(draft.copy(extraInstructions = it)) }, "Skip anything labelled needs-design.",
          multiline = true, lines = 3..12, mono = true,
        )
      }
    }
  }
}

@Composable
private fun Basics(draft: RemoteAutomationDetail, onChange: (RemoteAutomationDetail) -> Unit, showsSchedule: Boolean) {
  Field("Basics") {
    ThemedTextField(draft.name, { onChange(draft.copy(name = it)) }, "Name", input = TextInput.Name)
    if (showsSchedule) {
      ThemedTextField(draft.description, { onChange(draft.copy(description = it)) }, "What it does", multiline = true)
      SwitchRow("Enabled", draft.enabled) { onChange(draft.copy(enabled = it)) }
    }
  }
}

object AutomationFieldsText {
  fun triggerCaption(kind: RemoteAutomationDetailTriggerKind): String = when (kind) {
    RemoteAutomationDetailTriggerKind.once -> "Runs once at this time, then pauses itself."
    RemoteAutomationDetailTriggerKind.manual -> "Only runs when someone presses Run now."
    else -> "5 fields: minute hour day-of-month month day-of-week."
  }

  /** Picking "Once" without a time starts on the next whole hour. */
  fun withTriggerKind(draft: RemoteAutomationDetail, kind: RemoteAutomationDetailTriggerKind): RemoteAutomationDetail {
    val next = draft.copy(triggerKind = kind)
    return if (kind == RemoteAutomationDetailTriggerKind.once && draft.runAt == null) {
      next.copy(runAt = OnceTime.nextWholeHour(timezone = draft.timezone))
    } else {
      next
    }
  }

  /** Model ids don't carry across runners, and a custom runner's own credentials drop the account pin. */
  fun withRunner(draft: RemoteAutomationDetail, id: String): RemoteAutomationDetail {
    if (id == (draft.runner ?: "")) return draft
    val runner = id.ifEmpty { null }
    return draft.copy(
      runner = runner,
      model = null,
      claudeAccountId = if (AutomationAccountPin.appliesToRunner(runner)) draft.claudeAccountId else null,
    )
  }

  /** The computer's projects, plus any the draft still names that it no longer lists, so one can be switched off. */
  fun projectOptions(projects: List<RemoteProject>, picked: List<String>): List<ToggleOption> {
    val known = projects.map { it.repoRoot }.toSet()
    return projects.map { ToggleOption(it.repoRoot, it.name, icon = Icon.folder) } +
      picked.filter { it !in known }.map { ToggleOption(it, File(it).name, hint = "not open on this computer", icon = Icon.folder) }
  }
}

@Composable
private fun Trigger(draft: RemoteAutomationDetail, onChange: (RemoteAutomationDetail) -> Unit) {
  val theme = ArgusTheme.colors
  Field("Trigger", caption = AutomationFieldsText.triggerCaption(draft.triggerKind)) {
    SegmentedControl(
      draft.triggerKind,
      listOf(
        RemoteAutomationDetailTriggerKind.schedule to "Schedule",
        RemoteAutomationDetailTriggerKind.once to "Once",
        RemoteAutomationDetailTriggerKind.manual to "Manual",
      ),
    ) { onChange(AutomationFieldsText.withTriggerKind(draft, it)) }

    if (draft.triggerKind == RemoteAutomationDetailTriggerKind.schedule) {
      ThemedTextField(draft.cron ?: "", { onChange(draft.copy(cron = it)) }, "0 9 * * 1-5", mono = true, input = TextInput.Code)
    }
    if (draft.triggerKind == RemoteAutomationDetailTriggerKind.once) {
      OnceTimePicker(draft.runAt) { onChange(draft.copy(runAt = it)) }
      draft.onceError?.let { Text(it, color = theme.error, style = argusFont(13)) }
    }
    if (draft.triggerKind != RemoteAutomationDetailTriggerKind.manual) {
      ThemedTextField(draft.timezone ?: "", { onChange(draft.copy(timezone = it)) }, TimeZone.getDefault().id, input = TextInput.Code)
      draft.schedulePreviewText()?.let { preview ->
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
          val error = preview.error
          if (error != null) {
            Text(error, color = theme.error, style = argusFont(13))
          } else {
            preview.headline?.let { BodyText(it) }
            for (run in preview.runs) MonoText(run, size = 12, color = theme.textMuted)
          }
        }
      }
      SwitchRow(
        if (draft.triggerKind == RemoteAutomationDetailTriggerKind.once) "Still run if the computer was asleep at that time"
        else "Catch up after the computer was asleep",
        draft.catchUp,
      ) { onChange(draft.copy(catchUp = it)) }
    }
  }
}

@Composable
private fun Scope(draft: RemoteAutomationDetail, onChange: (RemoteAutomationDetail) -> Unit, context: AutomationFieldsContext) {
  Field("Scope", caption = "Repos the run may read, and what feeds it work.") {
    ToggleList(
      AutomationFieldsText.projectOptions(context.projects, draft.repoRoots), draft.repoRoots, { onChange(draft.copy(repoRoots = it)) },
      title = "Projects", emptyMessage = "This computer has no projects registered.",
    )
    ToggleList(
      context.sources.map { ToggleOption(it.id, it.label, hint = if (it.available) null else "not configured") },
      draft.sourceIds, { onChange(draft.copy(sourceIds = it)) },
      title = "Signal sources", emptyMessage = "This computer reported no signal sources.",
    )
  }
}

@Composable
private fun Behaviour(
  draft: RemoteAutomationDetail,
  onChange: (RemoteAutomationDetail) -> Unit,
  context: AutomationFieldsContext,
  showsSchedule: Boolean,
) {
  val selectedRunner = draft.runner?.let { id -> context.runners.firstOrNull { it.id == id } }
  val declaredModels = selectedRunner?.models.orEmpty()
  // A quick run is never pinned; it follows the active account.
  val offersAccount = showsSchedule && AutomationAccountPin.appliesToRunner(draft.runner) &&
    AutomationAccountPin.offered(context.accounts, draft.claudeAccountId)
  Field(
    "Behaviour",
    caption = draft.autonomyRung?.caption
      ?: "Autonomy is a ceiling request: the computer takes the lowest of this, its own default and the project's cap.",
  ) {
    FlowRow(Modifier.fillMaxWidth(), spacing = 6.dp, rowSpacing = 6.dp, packed = true) {
      MenuChip(
        "Autonomy", draft.autonomyRung?.rawValue ?: "",
        listOf(PickerOption("", "Inherit", "Use the computer's default")) +
          Autonomy.allRungs.map { PickerOption(it.rawValue, it.label, it.caption) },
        { onChange(draft.withAutonomy(Autonomy.fromRaw(it))) }, showsTitle = true,
      )
      if (context.runners.isNotEmpty()) {
        MenuChip(
          "Runner", draft.runner ?: "",
          listOf(PickerOption("", "Default", "Use the computer's default")) +
            context.runners.map { PickerOption(it.id, it.displayName, it.pickerHint, disabled = !it.isAvailable) },
          { onChange(AutomationFieldsText.withRunner(draft, it)) }, icon = Icon.terminal, showsTitle = true,
        )
      }
      if (offersAccount) {
        MenuChip(
          "Account", draft.claudeAccountId ?: "",
          AutomationAccountPin.options(context.accounts, context.activeAccountId, draft.claudeAccountId)
            .map { PickerOption(it.value, it.name, it.hint) },
          { onChange(draft.copy(claudeAccountId = it.ifEmpty { null })) }, icon = Icon.person, showsTitle = true,
        )
      }
      if (declaredModels.isNotEmpty()) {
        MenuChip(
          "Model", draft.model ?: "",
          listOf(PickerOption("", "Default", "Use the runner's default")) +
            declaredModels.map { PickerOption(it.value, it.displayName, it.description) },
          { onChange(draft.copy(model = it.ifEmpty { null })) }, showsTitle = true,
        )
      }
    }
    if (offersAccount && draft.claudeAccountId != null) MutedText(AutomationAccountPin.PINNED_CAPTION)
    // A runner that declares its models gets a menu; Claude Code only learns its list from a live handshake.
    if (declaredModels.isEmpty()) {
      ThemedTextField(
        draft.model ?: "", { onChange(draft.copy(model = it.ifEmpty { null })) }, "Model, blank uses the default",
        mono = true, input = TextInput.Code,
      )
    }
    GuardrailFields(draft.guardrails) { onChange(draft.copy(guardrails = it)) }
  }
}

@Composable
private fun Playbook(
  draft: RemoteAutomationDetail,
  onChange: (RemoteAutomationDetail) -> Unit,
  hasControl: Boolean,
  reviseError: String?,
  revise: (suspend (String) -> String?)?,
) {
  var revising by rememberSaveable { mutableStateOf(false) }
  Field("Playbook", caption = "Markdown instructions handed to the run's agent.") {
    ThemedTextField(
      draft.playbook, { onChange(draft.copy(playbook = it)) }, "What should this run do?", multiline = true, lines = 6..24, mono = true,
    )
    if (hasControl && revise != null) {
      Btn("Rewrite with Claude", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.draft, enabled = draft.playbook.isNotBlank()) {
        revising = true
      }
    }
  }
  if (revising && revise != null) {
    ReviseTextSheet(ReviseTextCopy.playbook, reviseError, revise, onApply = { onChange(draft.copy(playbook = it)) }, onDismiss = { revising = false })
  }
}
