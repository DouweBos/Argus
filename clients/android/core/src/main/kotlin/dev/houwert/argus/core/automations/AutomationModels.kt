package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailAutonomy
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationGuardrails
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteRunnerSetup
import dev.houwert.argus.kit.protocol.generated.RemoteSignalEventKind
import dev.houwert.argus.kit.protocol.generated.RemoteSignalTrigger
import dev.houwert.argus.kit.protocol.generated.RemoteSignalTriggerFire
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTrigger
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTriggerFire
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTriggerInput
import dev.houwert.argus.kit.protocol.generated.RemoteWebhookTriggerInputFire
import dev.houwert.argus.kit.protocol.generated.AutomationInputAutonomy
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

/** What a run says about the conversation it picked up; null when it had none to pick up. */
val RemoteAutomationRun.conversationNote: String?
  get() = when (conversation?.rawValue) {
    "continued" -> "Continued the previous run's conversation"
    "fell_back" -> "Started fresh: the previous run's conversation was gone"
    else -> null
  }

/** A skipped run's `error` is why it didn't fire, not something that broke. */
val RemoteAutomationRun.isSkipped: Boolean
  get() = status == RemoteAutomationRunStatus.skipped

/** The Automations list without teammates' duties, which live on their teammate's Duties page. */
data class StandaloneAutomations(val automations: List<RemoteAutomation>, val runs: List<RemoteAutomationRun>) {
  companion object {
    fun of(automations: List<RemoteAutomation>, runs: List<RemoteAutomationRun>): StandaloneAutomations {
      val duties = automations.filter { it.teammateId != null }.mapTo(HashSet()) { it.id }
      return StandaloneAutomations(automations.filter { it.id !in duties }, runs.filter { it.automationId !in duties })
    }
  }
}

/** The report's first line when there is one, else why it ran. */
val RemoteAutomationRun.summary: String get() = reportPreview?.takeIf { it.isNotEmpty() } ?: triggerReason

val RemoteRunnerSetup.canInstall: Boolean get() = installCommand != null || installUrl != null

val RemoteRunner.isAvailable: Boolean get() = available ?: true

/** What a trigger switched to `signal` starts with: one run per new issue. */
val defaultSignalTrigger = RemoteSignalTrigger(
  on = listOf(RemoteSignalEventKind.newIssue),
  labels = emptyList(),
  fire = RemoteSignalTriggerFire.each,
  maxRunsPerHour = 4.0,
)

/** What a trigger switched to `webhook` starts with; the computer fills in the URL and secret. */
val defaultWebhookTrigger = RemoteWebhookTrigger(fire = RemoteWebhookTriggerFire.each, maxRunsPerHour = 4.0, hasSecret = false)

/** The signal events in the order a picker lists them, with their labels. */
val signalEventOptions: List<Pair<RemoteSignalEventKind, String>> = listOf(
  RemoteSignalEventKind.newIssue to "New issue",
  RemoteSignalEventKind.newPr to "New pull request",
  RemoteSignalEventKind.assigned to "Assigned to me",
  RemoteSignalEventKind.reviewRequested to "Review requested",
  RemoteSignalEventKind.ciFailed to "My CI failed",
  RemoteSignalEventKind.mentioned to "Mentioned",
)

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
  triggerKind: RemoteAutomationTriggerKind = RemoteAutomationTriggerKind.schedule,
  cron: String? = "0 9 * * 1-5",
  runAt: String? = null,
  timezone: String? = TimeZone.getDefault().id,
  catchUp: Boolean = true,
  repoRoots: List<String> = emptyList(),
  sourceIds: List<String> = emptyList(),
  playbook: String = "",
  extraInstructions: String = "",
  claudeAccountId: String? = null,
  precheckCommand: String? = "",
  continueConversation: Boolean? = false,
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
  precheckCommand = precheckCommand,
  continueConversation = continueConversation,
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
    triggerKind = detail.triggerKind,
    slackChannel = detail.slackChannel,
    slackMatch = detail.slackMatch,
    slackText = detail.slackText,
    reportSlackChannel = detail.reportSlackChannel,
    cron = detail.cron ?: "",
    runAt = detail.onceRunAt,
    signal = detail.signalInput,
    webhook = detail.webhookInput,
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
    precheckCommand = detail.precheckCommand?.trim(),
    precheckTimeoutSeconds = detail.precheckTimeoutSeconds,
    continueConversation = detail.continueConversation,
  )

  fun patch(detail: RemoteAutomationDetail) = MethodsTypes.AutomationsUpdateParamsPatch(
    name = detail.name,
    description = detail.description,
    enabled = detail.enabled,
    triggerKind = detail.clockTrigger,
    cron = detail.clockTrigger?.let { detail.cron ?: "" },
    runAt = detail.onceRunAt,
    signal = detail.signalInput,
    webhook = detail.webhookInput,
    timezone = detail.clockTrigger?.let { detail.timezone ?: TimeZone.getDefault().id },
    catchUp = detail.clockTrigger?.let { detail.catchUp },
    repoRoots = detail.repoRoots,
    sourceIds = detail.sourceIds,
    playbook = detail.playbook,
    extraInstructions = detail.extraInstructions,
    autonomy = detail.autonomy?.let { MethodsTypes.AutomationsUpdateParamsPatchAutonomy(it.rawValue) },
    model = detail.model,
    runner = detail.runner,
    claudeAccountId = detail.claudeAccountId,
    guardrails = detail.guardrails,
    precheckCommand = detail.precheckCommand?.trim(),
    precheckTimeoutSeconds = detail.precheckTimeoutSeconds,
    continueConversation = detail.continueConversation,
  )

  /**
   * Null for a Slack trigger: the phone can't edit one, and any trigger field in a patch makes the
   * computer rebuild the trigger.
   */
  private val RemoteAutomationDetail.clockTrigger get() = triggerKind.takeIf { it != RemoteAutomationTriggerKind.slack }

  /** Sent only for a run-once trigger, so an older computer never sees it. */
  private val RemoteAutomationDetail.onceRunAt get() = runAt.takeIf { triggerKind == RemoteAutomationTriggerKind.once }

  /** Sent only for their own kind; the URL and secret state are the computer's, never the editor's. */
  private val RemoteAutomationDetail.signalInput
    get() = if (triggerKind == RemoteAutomationTriggerKind.signal) signal ?: defaultSignalTrigger else null

  private val RemoteAutomationDetail.webhookInput
    get() = if (triggerKind != RemoteAutomationTriggerKind.webhook) null else RemoteWebhookTriggerInput(
      fire = RemoteWebhookTriggerInputFire(webhook?.fire?.rawValue ?: "each"),
      maxRunsPerHour = webhook?.maxRunsPerHour ?: 4.0,
    )
}
