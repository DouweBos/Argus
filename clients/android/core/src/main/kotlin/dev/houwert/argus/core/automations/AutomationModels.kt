package dev.houwert.argus.core.automations

import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailAutonomy
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationGuardrails
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRunStatus
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteRunnerSetup
import java.util.TimeZone
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import dev.houwert.argus.kit.protocol.ProtocolJson

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
 * The create/patch body for an automation, encoded by hand: `autonomy`, `model`,
 * `runner` and `claude_account_id` go out as null rather than missing, since null
 * is "inherit", which the host requires on create and needs to clear a patch.
 */
object AutomationInput {
  fun encode(detail: RemoteAutomationDetail): JsonElement = buildJsonObject {
    put("name", detail.name)
    put("description", detail.description)
    put("enabled", detail.enabled)
    put("trigger_kind", detail.triggerKind.rawValue)
    put("cron", detail.cron ?: "")
    // Sent only for a run-once trigger, so an older computer never sees it.
    if (detail.triggerKind == RemoteAutomationDetailTriggerKind.once) detail.runAt?.let { put("run_at", it) }
    put("timezone", detail.timezone ?: TimeZone.getDefault().id)
    put("catch_up", detail.catchUp)
    putJsonArray("repo_roots") { detail.repoRoots.forEach { add(JsonPrimitive(it)) } }
    putJsonArray("source_ids") { detail.sourceIds.forEach { add(JsonPrimitive(it)) } }
    put("playbook", detail.playbook)
    put("extra_instructions", detail.extraInstructions)
    put("autonomy", detail.autonomy?.rawValue?.let(::JsonPrimitive) ?: JsonNull)
    put("model", detail.model?.let(::JsonPrimitive) ?: JsonNull)
    put("runner", detail.runner?.let(::JsonPrimitive) ?: JsonNull)
    put("claude_account_id", detail.claudeAccountId?.let(::JsonPrimitive) ?: JsonNull)
    put("guardrails", ProtocolJson.json.encodeToJsonElement(RemoteAutomationGuardrails.serializer(), detail.guardrails))
  }
}
