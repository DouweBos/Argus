package dev.houwert.argus.core.compare

import dev.houwert.argus.core.agents.ModelName
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.MergeStrategy
import dev.houwert.argus.core.stores.lastKnownModels
import dev.houwert.argus.core.stores.loadAgents
import dev.houwert.argus.core.stores.loadSessions
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteCompareSlot
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.SessionCompareGroup
import kotlinx.coroutines.flow.update

// Compare runs: one prompt on several runners or models, a session per slot,
// scored side by side, then one kept and the rest deleted.

/**
 * One session per slot off [baseBranch], each starting on the prompt once set up.
 * Settings' [defaultModel]/[defaultEffort] belong to the default runner only, as for a single start.
 * Returns the run's sessions in slot order; null when the computer refused.
 */
suspend fun HostStore.startCompare(
  repoRoot: String,
  baseBranch: String?,
  prompt: String,
  displayText: String,
  slots: List<CompareSlot>,
  images: List<RemoteImageAttachment> = emptyList(),
  permissionMode: RemotePermissionMode? = null,
  defaultModel: String? = null,
  defaultEffort: String? = null,
  linearIssue: String? = null,
): List<RemoteSession>? {
  val backend = backend ?: return null
  val wireSlots = slots.map {
    MethodsTypes.SessionsCreateCompareParamsSlotsItem(
      runnerId = it.runnerId,
      model = it.model ?: defaultModel.takeIf { _ -> it.runnerId == null },
      effort = it.effort ?: defaultEffort.takeIf { _ -> it.runnerId == null },
    )
  }
  return try {
    val result = backend.request(
      Methods.SessionsCreateCompare,
      MethodsTypes.SessionsCreateCompareParams(
        repoRoot = repoRoot, description = displayText, baseBranch = baseBranch, prompt = prompt,
        images = images.ifEmpty { null }, permissionMode = permissionMode, linearIssue = linearIssue, slots = wireSlots,
      ),
    )
    result.sessions.forEach { creatingSessions[it.id] = it }
    val ids = result.sessions.map { it.id }.toSet()
    _sessionsByRepo.update { map -> map + (repoRoot to result.sessions + map[repoRoot].orEmpty().filter { it.id !in ids }) }
    loadSessions(repoRoot)
    result.sessions
  } catch (e: Exception) {
    report(e, "session:compare")
    null
  }
}

/** The run's sessions this store holds, in slot order. */
fun HostStore.compareSessions(groupId: String): List<RemoteSession> =
  sessionsByRepo.value.values.flatten().filter { it.compareGroup?.id == groupId }.sortedBy { it.compareGroup?.slot ?: 0 }

/** Every slot, scored; null when the run is gone or the computer can't say. */
suspend fun HostStore.loadCompare(groupId: String): List<RemoteCompareSlot>? {
  val backend = backend ?: return null
  return runCatching { backend.request(Methods.SessionsCompare, MethodsTypes.SessionsCompareParams(groupId)).slots }.getOrNull()
}

/** PNG bytes of what the slot's simulator or browser shows; null when nothing is up. */
suspend fun HostStore.compareScreenshot(sessionId: String): ByteArray? {
  val backend = backend ?: return null
  val image = runCatching { backend.request(Methods.SessionsCompareScreenshot, MethodsTypes.SessionsCompareScreenshotParams(sessionId)).image }
    .getOrNull() ?: return null
  return runCatching { java.util.Base64.getDecoder().decode(image) }.getOrNull()
}

/** What keeping a slot did. */
data class CompareKept(val pullRequestUrl: String?, val deleted: Int)

/** Lands the slot, then deletes the run's other slots. Null when landing failed, in which case nothing was deleted. */
suspend fun HostStore.keepCompare(
  sessionId: String,
  land: CompareLanding,
  strategy: MergeStrategy = MergeStrategy.Squash,
  deleteOthers: Boolean,
): CompareKept? {
  val backend = backend ?: return null
  val repoRoot = repoRoot(sessionId) ?: return null
  return try {
    val result = backend.request(
      Methods.SessionsKeepCompare,
      MethodsTypes.SessionsKeepCompareParams(
        sessionId = sessionId,
        land = MethodsTypes.SessionsKeepCompareParamsLand(land.wire),
        strategy = if (land == CompareLanding.Merge) MethodsTypes.SessionsKeepCompareParamsStrategy(strategy.wire) else null,
        deleteOthers = deleteOthers,
      ),
    )
    if (land == CompareLanding.Merge) _mergedSessionIds.update { it + sessionId }
    loadSessions(repoRoot)
    loadAgents(repoRoot)
    CompareKept(result.pullRequestUrl, result.deleted.toInt())
  } catch (e: Exception) {
    report(e, "session:keep-compare")
    null
  }
}

// How a compare slot is named wherever it shows: its runner, then its model.

/** The runner's name; null is the computer's default runner, Claude Code. */
fun HostStore.compareRunnerName(runnerId: String?): String {
  val id = runnerId ?: "claude-code"
  return runners.value.firstOrNull { it.id == id }?.displayName ?: if (runnerId == null) "Claude Code" else id
}

/** The model's name as the runner reports it; null when the runner picks its own. */
fun HostStore.compareModelName(runnerId: String?, model: String?): String? {
  model ?: return null
  val declared = runners.value.firstOrNull { it.id == (runnerId ?: "claude-code") }?.models.orEmpty()
    .map { RemoteModelInfo(value = it.value, displayName = it.displayName, description = it.description ?: "") }
  val known = declared.ifEmpty { lastKnownModels(runnerId) }
  return ModelName.label(model, known) ?: model
}

/** "Codex · GPT-5", or the runner alone. */
fun HostStore.compareSlotTitle(runnerId: String?, model: String?): String {
  val runner = compareRunnerName(runnerId)
  val modelName = compareModelName(runnerId, model) ?: return runner
  return "$runner · $modelName"
}

fun HostStore.compareSlotTitle(slot: SessionCompareGroup): String = compareSlotTitle(slot.runnerId, slot.model)
