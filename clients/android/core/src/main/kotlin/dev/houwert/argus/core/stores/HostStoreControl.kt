package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.protocol.generated.RemoteImageRef
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.generated.RemotePermissionRequest
import dev.houwert.argus.kit.protocol.generated.RemoteQueuedMessage
import dev.houwert.argus.kit.protocol.generated.RemoteQueuedMessageImagesItem
import java.util.UUID
import kotlin.random.Random
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// Control-scoped actions. The gateway refuses each without the `control`
// grant; `hasControl` only decides whether the UI offers the button.

// Messaging

suspend fun HostStore.sendMessage(
  agentId: String,
  message: String,
  images: List<RemoteImageAttachment> = emptyList(),
  displayText: String? = null,
  isRetry: Boolean = false,
) {
  if (shouldHoldReply) return holdReply(agentId, message, displayText, images)
  val localId = appendOptimistic(agentId, displayText ?: message, images)
  // No socket at all still has to land somewhere the user can see and retry.
  val backend = backend ?: return markFailed(agentId, localId, message, displayText, images, isRetry)
  try {
    val result = backend.request(Methods.AgentsSend, MethodsTypes.AgentsSendParams(agentId, message, displayText, images.ifEmpty { null }))
    hooks.track(StoreEvent.MessageSent(queued = result.queued == true, hasImages = images.isNotEmpty(), length = message.length))
    // The computer queues a send it can't steer into the turn (a pending prompt, a pause, an ACP runner): the queue shows it.
    if (result.queued == true) {
      loadQueue(agentId)
      _optimisticByAgent.update { it.removingItem(agentId) { m -> m.id == localId } }
      return
    }
    refreshTranscript(agentId)
  } catch (e: Exception) {
    report(e, "agent:send")
    markFailed(agentId, localId, message, displayText, images, isRetry)
  }
}

/** Move a bubble from "sent" to "not sent", or it reads as delivered and nothing ever retries it. */
private fun HostStore.markFailed(
  agentId: String,
  localId: String,
  message: String,
  displayText: String?,
  images: List<RemoteImageAttachment>,
  isRetry: Boolean,
) {
  hooks.track(StoreEvent.MessageSendFailed(retried = isRetry))
  _optimisticByAgent.update { it.removingItem(agentId) { m -> m.id == localId } }
  _failedByAgent.update { it.appendingItem(agentId, FailedSend(localId, message, displayText, images)) }
}

/** Send a failed message again; it leaves the failed list first so a second failure doesn't show it twice. */
suspend fun HostStore.retryFailed(agentId: String, id: String) {
  val pending = _failedByAgent.value[agentId]?.firstOrNull { it.id == id } ?: return
  discardFailed(agentId, id)
  sendMessage(agentId, pending.body, pending.images, pending.displayText, isRetry = true)
}

fun HostStore.discardFailed(agentId: String, id: String) {
  _failedByAgent.update { it.removingItem(agentId) { m -> m.id == id } }
}

/** Show the user's message at once, attachments included, rather than waiting for the snapshot. */
private fun HostStore.appendOptimistic(agentId: String, text: String, images: List<RemoteImageAttachment>): String {
  val id = optimisticId()
  val refs = images.mapIndexed { index, image ->
    val imageId = "$id:img:$index"
    seedImage(agentId, imageId, "data:${image.mediaType};base64,${image.data}")
    RemoteImageRef(imageId, image.mediaType)
  }
  val message = RemoteMessage(
    id = id,
    role = RemoteMessageRole.user,
    textBlocks = listOf(text),
    toolCalls = emptyList(),
    images = refs.ifEmpty { null },
    timestamp = System.currentTimeMillis().toDouble(),
  )
  _optimisticByAgent.update { it.appendingItem(agentId, message) }
  return id
}

/** Bubbles that exist only on this phone so far, drawn as "sending". */
fun HostStore.Companion.isOptimistic(id: String) = id.startsWith("optimistic-")

private fun optimisticId() = "optimistic-${System.currentTimeMillis()}-${Random.nextInt(10_000)}"

// Queue: lives on the computer, shared with the desktop, which drains it. The
// host's list is authoritative; it comes back on `agent.queue` and `loadQueue`.

suspend fun HostStore.queueMessage(agentId: String, message: String, images: List<RemoteImageAttachment>, displayText: String) {
  // Replayed as a plain message on reconnect, which joins a running turn rather than waiting for it.
  if (shouldHoldReply) return holdReply(agentId, message, displayText, images)
  val backend = backend ?: run {
    _failedByAgent.update { it.appendingItem(agentId, FailedSend("failed-${UUID.randomUUID()}", message, displayText, images)) }
    return
  }
  val sending = RemoteQueuedMessage(
    id = optimisticId(),
    text = message,
    displayText = displayText,
    images = images.map { RemoteQueuedMessageImagesItem(it.data, it.mediaType) }.ifEmpty { null },
    queuedAt = System.currentTimeMillis().toDouble(),
  )
  _sendingQueuedByAgent.update { it.appendingItem(agentId, sending) }
  try {
    backend.request(Methods.AgentsQueueAdd, MethodsTypes.AgentsQueueAddParams(agentId, message, displayText, images.ifEmpty { null }))
    hooks.track(StoreEvent.MessageSent(queued = true, hasImages = images.isNotEmpty(), length = message.length))
    loadQueue(agentId)
  } catch (e: Exception) {
    report(e, "agent:queue")
    hooks.track(StoreEvent.MessageSendFailed(retried = false))
    // The computer's queue is the only record, and it has no row for this.
    _failedByAgent.update { it.appendingItem(agentId, FailedSend("failed-${UUID.randomUUID()}", message, displayText, images)) }
  } finally {
    _sendingQueuedByAgent.update { it.removingItem(agentId) { m -> m.id == sending.id } }
  }
}

suspend fun HostStore.loadQueue(agentId: String) {
  val backend = backend ?: return
  if (holdsFresher(agentId in _queuedByAgent.value)) return
  val (result, seq) = runCatching { backend.sequencedRequest(Methods.AgentsQueueList, MethodsTypes.AgentsQueueListParams(agentId)) }.getOrNull() ?: return
  applyQueue(result.messages, agentId, seq)
}

/** Take the host's queue unless something newer landed: a list answered before a drain can arrive after its event. */
internal fun HostStore.applyQueue(messages: List<RemoteQueuedMessage>, agentId: String, seq: Int) {
  if (seq != Int.MIN_VALUE) {
    val held = queueSeq[agentId]
    if (held != null && held > seq) return
    queueSeq[agentId] = seq
  }
  _queuedByAgent.update { it + (agentId to messages) }
}

/** Queue events missed while disconnected are gone; re-read every queue on screen or still showing entries. */
fun HostStore.resyncQueues() {
  val agents = _queuedByAgent.value.filterValues { it.isNotEmpty() }.keys + watchedAgents
  for (agentId in agents) {
    queueSeq.remove(agentId)
    scope.launch { loadQueue(agentId) }
  }
}

suspend fun HostStore.removeQueued(agentId: String, id: String) {
  val backend = backend ?: return
  // Gone at once; the re-read puts it back if the host kept it.
  _queuedByAgent.update { map -> map[agentId]?.let { map + (agentId to it.filterNot { m -> m.id == id }) } ?: map }
  try {
    backend.request(Methods.AgentsQueueRemove, MethodsTypes.AgentsQueueRemoveParams(agentId, id))
  } catch (e: Exception) {
    report(e)
  }
  loadQueue(agentId)
}

suspend fun HostStore.updateQueued(agentId: String, id: String, message: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.AgentsQueueUpdate, MethodsTypes.AgentsQueueUpdateParams(agentId, id, message))
    loadQueue(agentId)
  } catch (e: Exception) {
    report(e)
  }
}

/** Send one queued message ahead of the rest; a busy agent takes it into its running turn. */
suspend fun HostStore.sendQueuedNow(agentId: String, id: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.AgentsQueueSendNow, MethodsTypes.AgentsQueueSendNowParams(agentId, id))
  } catch (e: Exception) {
    report(e, "agent:queue")
  }
  loadQueue(agentId)
}

// Permissions

/** The agent's open prompt, subscribing just long enough for the gateway to replay it. */
suspend fun HostStore.awaitPendingPrompt(agentId: String, timeout: Duration = 4.seconds): RemotePermissionRequest? {
  fun current() = _prompts.value.values.firstOrNull { it.agentId == agentId }
  current()?.let { return it }
  val alreadyWatched = agentId in watchedAgents
  if (!alreadyWatched) watchAgent(agentId, true)
  val deadline = System.nanoTime() + timeout.inWholeNanoseconds
  while (current() == null && System.nanoTime() < deadline) delay(150)
  val prompt = current()
  // The replay registered the prompt with this connection; the subscription can go.
  if (!alreadyWatched) watchAgent(agentId, false)
  return prompt
}

/** [alwaysAllow] asks for an "Always allow" rule for the rest of the session; the gateway derives it. */
suspend fun HostStore.respond(
  agentId: String,
  toolUseId: String,
  decision: String,
  message: String? = null,
  alwaysAllow: String? = null,
  fromNotification: Boolean = false,
) {
  hooks.track(StoreEvent.PermissionAnswered(approved = decision == "allow", alwaysAllow = alwaysAllow != null, fromNotification = fromNotification))
  // Clear the inline form at once; the round trip only confirms it.
  val key = promptKey(agentId, toolUseId)
  val prompt = _prompts.value[key]
  _prompts.update { it - key }
  _answered.update { it + key }
  // Offline, the answer waits for the connection like a notification's does.
  val backend = backend
  if (backend == null || shouldHoldReply) return hooks.decisionUndelivered(agentId, toolUseId, decision)
  try {
    val result = backend.request(
      Methods.PermissionRespond,
      MethodsTypes.PermissionRespondParams(
        agentId,
        toolUseId,
        MethodsTypes.PermissionRespondParamsDecision(decision),
        message,
        if (alwaysAllow != null) true else null,
      ),
    )
    if (alwaysAllow != null && result.allowRule == null) _lastError.value = HostStore.ALWAYS_ALLOW_UNSUPPORTED
    refreshTranscript(agentId)
  } catch (e: Exception) {
    _lastError.value = HostStore.refusedAnswerMessage(e)
    // The host has nothing waiting there, so a retry can only fail again.
    if (HostStore.isPromptGone(e)) return refreshTranscript(agentId)
    // Refused or lost: put the prompt back so it can be answered again.
    _answered.update { it - key }
    if (prompt != null) _prompts.update { it + (key to prompt) }
    hooks.decisionUndelivered(agentId, toolUseId, decision)
  }
}

/** Answer a `request_secret` card; null declines. The value goes to the host and nowhere else. */
suspend fun HostStore.respondSecret(agentId: String, toolUseId: String, value: String?) {
  val key = promptKey(agentId, toolUseId)
  val prompt = _prompts.value[key]
  _prompts.update { it - key }
  _answered.update { it + key }
  fun restore() {
    _answered.update { it - key }
    if (prompt != null) _prompts.update { it + (key to prompt) }
  }
  val backend = backend ?: run {
    restore()
    _lastError.value = "Not connected to your computer. Try again once it's back."
    return
  }
  try {
    backend.request(Methods.SecretRespond, MethodsTypes.SecretRespondParams(agentId, toolUseId, value))
    refreshTranscript(agentId)
  } catch (e: Exception) {
    _lastError.value = HostStore.refusedAnswerMessage(e)
    if (HostStore.isPromptGone(e)) return refreshTranscript(agentId)
    restore()
  }
}

internal fun HostStore.Companion.isPromptGone(error: Throwable) = "no such outstanding prompt" in describe(error)

/** An older computer ignores the request and allows the call just once. */
val HostStore.Companion.ALWAYS_ALLOW_UNSUPPORTED get() = "Allowed once. Update Argus on your computer to always allow from here."

/** Why an answer didn't land, in words. */
fun HostStore.Companion.refusedAnswerMessage(error: Throwable): String {
  if (!isPromptGone(error)) return "Your answer didn't reach the agent: ${describe(error)}"
  return "That prompt is no longer waiting. The agent may have stopped or someone else answered it."
}

// Agent lifecycle

suspend fun HostStore.interrupt(agentId: String) {
  val backend = backend ?: return
  hooks.track(StoreEvent.AgentControlled(StoreEvent.AgentAction.Interrupt))
  runCatching { backend.request(Methods.AgentsInterrupt, MethodsTypes.AgentsInterruptParams(agentId)) }
}

/** Cancel the continue scheduled after a usage limit; the host captures it. */
suspend fun HostStore.dismissLimitResume(agentId: String) {
  val backend = backend ?: return
  runCatching { backend.request(Methods.AgentsDismissLimitResume, MethodsTypes.AgentsDismissLimitResumeParams(agentId)) }
}

suspend fun HostStore.stopAgent(agentId: String) {
  val backend = backend ?: return
  hooks.track(StoreEvent.AgentControlled(StoreEvent.AgentAction.Stop))
  try {
    backend.request(Methods.AgentsStop, MethodsTypes.AgentsStopParams(agentId))
    // The host forgets a stopped agent rather than announcing it.
    agentExited(agentId, 0)
  } catch (e: Exception) {
    report(e)
  }
}

internal fun HostStore.agentExited(agentId: String, code: Int) {
  val state = if (code == 0) RemoteAgentStatusStatus.stopped else RemoteAgentStatusStatus.error
  patchStatus(agentId) { it.copy(status = state) }
  val sessionId = _statusByAgent.value[agentId]?.sessionId ?: return
  scope.launch {
    val repoRoot = repoRoot(sessionId)
    if (repoRoot != null) loadAgents(repoRoot) else loadRecentAgents()
  }
}

suspend fun HostStore.loadCapabilities(agentId: String) {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.AgentsCapabilities, MethodsTypes.AgentsCapabilitiesParams(agentId)) }.getOrNull() ?: return
  _capabilitiesByAgent.update { it + (agentId to result.capabilities) }
}

suspend fun HostStore.setModel(agentId: String, model: String) {
  val backend = backend ?: return
  hooks.track(StoreEvent.AgentControlled(StoreEvent.AgentAction.Model))
  try {
    backend.request(Methods.AgentsSetModel, MethodsTypes.AgentsSetModelParams(agentId, model))
    loadAgentStatus(agentId)
  } catch (e: Exception) {
    report(e)
  }
}

suspend fun HostStore.setPermissionMode(agentId: String, mode: RemotePermissionMode) {
  val backend = backend ?: return
  hooks.track(StoreEvent.AgentControlled(StoreEvent.AgentAction.PermissionMode))
  try {
    backend.request(Methods.AgentsSetPermissionMode, MethodsTypes.AgentsSetPermissionModeParams(agentId, mode))
    loadAgentStatus(agentId)
  } catch (e: Exception) {
    report(e)
  }
}

/** Approving a plan leaves plan mode, which only shows on the next poll; move the chip now so it doesn't lie. */
fun HostStore.noteLeftPlanMode(agentId: String) {
  if (_statusByAgent.value[agentId]?.permissionMode != RemotePermissionMode.plan.rawValue) return
  _statusByAgent.update { map -> map[agentId]?.let { map + (agentId to it.copy(permissionMode = RemotePermissionMode.auto.rawValue)) } ?: map }
}

suspend fun HostStore.setEffort(agentId: String, level: String?) {
  hooks.track(StoreEvent.AgentControlled(StoreEvent.AgentAction.Effort))
  applyEffort(agentId, level)
}

/** [setEffort] without counting it as the user's: a resume carrying the old one over. */
internal suspend fun HostStore.applyEffort(agentId: String, level: String?) {
  val backend = backend ?: return
  // The monitor snapshot doesn't carry effort, so remember the choice here.
  _effortByAgent.update { it.with(agentId, level) }
  try {
    backend.request(Methods.AgentsSetEffort, MethodsTypes.AgentsSetEffortParams(agentId, level))
  } catch (e: Exception) {
    report(e)
  }
}

suspend fun HostStore.spawnAgent(
  sessionId: String,
  model: String? = null,
  permissionMode: RemotePermissionMode? = null,
  resumeSessionId: String? = null,
  runnerId: String? = null,
  claudeAccountId: String? = null,
): RemoteAgentStatus? {
  val backend = backend ?: return null
  return try {
    val agent = backend.request(
      Methods.AgentsSpawn,
      MethodsTypes.AgentsSpawnParams(sessionId, model, permissionMode, resumeSessionId, runnerId, claudeAccountId),
    ).agent
    _statusByAgent.update { it + (agent.agentId to agent) }
    // The tab can't hang on `agent:started` alone: a missed event loses it.
    repoRoot(sessionId)?.let { loadAgents(it) }
    agent
  } catch (e: Exception) {
    report(e)
    null
  }
}
