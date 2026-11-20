package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailAutonomy
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationGuardrails
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteRunnerSetup
import dev.houwert.argus.kit.protocol.generated.AutomationInputAutonomy
import dev.houwert.argus.kit.protocol.generated.AutomationInputTriggerKind
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import java.util.TimeZone
import dev.houwert.argus.kit.protocol.generated.AutomationInput as GeneratedAutomationInput

// The computed members of ArgusKit's hand-written `Protocol/Automations.swift`, on the generated types.

/** How far a run may go on its own; null on an automation means "inherit the computer's cap". */
enum class Autonomy(val rawValue: String, val label: String, val caption: String) {
  Propose("propose", "Propose", "Write a proposal into the inbox; touch nothing."),
  Draft("draft", "Draft", "Create the worktree, implement, commit — then stop."),
  Pr("pr", "Pull request", "Draft, then push and open a draft PR."),
  AutoMerge("auto_merge", "Auto-merge", "PR, then merge once CI is green.");

  companion object {
    /** Weakest first, the order the desktop ladder reads in. */
    val allRungs = entries.toList()

    fun fromRaw(raw: String?): Autonomy? = entries.firstOrNull { it.rawValue == raw }
  }
}

val RemoteAutomationDetail.autonomyRung: Autonomy? get() = Autonomy.fromRaw(autonomy?.rawValue)

fun RemoteAutomationDetail.withAutonomy(rung: Autonomy?) = copy(autonomy = rung?.let { RemoteAutomationDetailAutonomy(it.rawValue) })

val RemoteAutomationRun.isActive: Boolean
  get() = status == RemoteAutomationRunStatus.queued || status == RemoteAutomationRunStatus.running

/** The report's first line when there is one, else why it ran. */
val RemoteAutomationRun.summary: String get() = reportPreview?.takeIf { it.isNotEmpty() } ?: triggerReason

val RemoteRunnerSetup.canInstall: Boolean get() = installCommand != null || installUrl != null

val RemoteRunner.isAvailable: Boolean get() = available ?: true

/** The guardrails a new automation starts with, as the host's defaults. */
val defaultGuardrails = RemoteAutomationGuardrails(
  confidenceThreshold = 0.8,
  maxConcurrentSessions = 2.0,
  maxFilesChanged = 25.0,
  maxCostUsdPerRun = 0.0,
  maxRunMinutes = 20.0,
  pathDenylist = emptyList(),
  requireCleanCi = true,
  retryOtherAccounts = true,
)

/** A blank automation, as the editor opens one. */
fun newAutomationDetail(
  name: String = "",
  enabled: Boolean = true,
  triggerKind: RemoteAutomationDetailTriggerKind = RemoteAutomationDetailTriggerKind.schedule,
  cron: String? = "0 9 * * 1-5",
  runAt: String? = null,
  timezone: String? = TimeZone.getDefault().id,
  catchUp: Boolean = true,
  repoRoots: List<String> = emptyList(),
  sourceIds: List<String> = emptyList(),
  playbook: String = "",
  extraInstructions: String = "",
  claudeAccountId: String? = null,
) = RemoteAutomationDetail(
  id = "",
  name = name,
  description = "",
  enabled = enabled,
  triggerKind = triggerKind,
  cron = cron,
  runAt = runAt,
  timezone = timezone,
  catchUp = catchUp,
  repoRoots = repoRoots,
  sourceIds = sourceIds,
  playbook = playbook,
  extraInstructions = extraInstructions,
  claudeAccountId = claudeAccountId,
  guardrails = defaultGuardrails,
)

/**
 * The create and patch bodies for an automation. Null `autonomy`/`model`/`runner`/`claude_account_id`
 * mean "inherit"; a patch must send them as null to clear a pin, which its all-optional type can't say.
 */
object AutomationInput {
  val clearablePatchPaths = arrayOf("patch.autonomy", "patch.model", "patch.runner", "patch.claude_account_id")

  fun create(detail: RemoteAutomationDetail) = GeneratedAutomationInput(
    name = detail.name,
    description = detail.description,
    enabled = detail.enabled,
    triggerKind = AutomationInputTriggerKind(detail.triggerKind.rawValue),
    cron = detail.cron ?: "",
    runAt = detail.onceRunAt,
    timezone = detail.timezone ?: TimeZone.getDefault().id,
    catchUp = detail.catchUp,
    repoRoots = detail.repoRoots,
    sourceIds = detail.sourceIds,
    playbook = detail.playbook,
    extraInstructions = detail.extraInstructions,
    autonomy = detail.autonomy?.let { AutomationInputAutonomy(it.rawValue) },
    model = detail.model,
    runner = detail.runner,
    claudeAccountId = detail.claudeAccountId,
    guardrails = detail.guardrails,
  )

  fun patch(detail: RemoteAutomationDetail) = MethodsTypes.AutomationsUpdateParamsPatch(
    name = detail.name,
    description = detail.description,
    enabled = detail.enabled,
    triggerKind = MethodsTypes.AutomationsUpdateParamsPatchTriggerKind(detail.triggerKind.rawValue),
    cron = detail.cron ?: "",
    runAt = detail.onceRunAt,
    timezone = detail.timezone ?: TimeZone.getDefault().id,
    catchUp = detail.catchUp,
    repoRoots = detail.repoRoots,
    sourceIds = detail.sourceIds,
    playbook = detail.playbook,
    extraInstructions = detail.extraInstructions,
    autonomy = detail.autonomy?.let { MethodsTypes.AutomationsUpdateParamsPatchAutonomy(it.rawValue) },
    model = detail.model,
    runner = detail.runner,
    claudeAccountId = detail.claudeAccountId,
    guardrails = detail.guardrails,
  )

  /** Sent only for a run-once trigger, so an older computer never sees it. */
  private val RemoteAutomationDetail.onceRunAt get() = runAt.takeIf { triggerKind == RemoteAutomationDetailTriggerKind.once }
}
