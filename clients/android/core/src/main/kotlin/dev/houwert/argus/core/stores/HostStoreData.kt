package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.EmptyParams
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.Commands
import dev.houwert.argus.kit.protocol.generated.CommandsTypes
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteGitBranch
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteModelInfo
import dev.houwert.argus.kit.protocol.generated.RemotePermissionRequest
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionTurn
import dev.houwert.argus.kit.protocol.generated.RemoteTask
import dev.houwert.argus.kit.protocol.generated.RemoteTodo
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChild
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus

import kotlinx.coroutines.flow.update

/** One page of a transcript, live or saved, in the shape the store merges. */
data class RemoteTranscript(
  val messages: List<RemoteMessage>,
  val prevBefore: Long? = null,
  val total: Long? = null,
  val tasks: List<RemoteTask>? = null,
  val todos: List<RemoteTodo>? = null,
  /** Replies suggested once the last turn ended; null from an older host. */
  val followUps: List<String>? = null,
  val model: String? = null,
  val pendingToolName: String? = null,
  /** Where the page sits among `agent.transcript` deltas; null from a host that sends none. */
  val epoch: String? = null,
  val revision: Long? = null,
) {
  companion object {
    val EMPTY = RemoteTranscript(emptyList())
  }
}

// Monitor-scoped loading: lists, transcripts, images, git state. Sessions and
// projects arrive as events with a slow poll behind them; transcripts are
// event-driven with a poll as a backstop.

suspend fun HostStore.refreshProjects() {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.ProjectsList, MethodsTypes.ProjectsListParams()) }.getOrNull() ?: return
  _projects.value = result.projects
  _projectsLoaded.value = true
}

/** Drops the project from the host's list, stopping its agents; the repo and worktrees stay on disk. */
suspend fun HostStore.removeProject(repoRoot: String) {
  val backend = backend ?: return
  try {
    backend.request(Methods.ProjectsRemove, MethodsTypes.ProjectsRemoveParams(repoRoot))
    _projects.update { list -> list.filterNot { it.repoRoot == repoRoot } }
    refreshProjects()
  } catch (e: Exception) {
    report(e)
  }
}

suspend fun HostStore.loadRecentAgents() {
  val backend = backend ?: return
  if (holdsFresher(_recentAgentsLoaded.value)) return
  val result = runCatching { backend.request(Methods.AgentsList, MethodsTypes.AgentsListParams()) }.getOrNull() ?: return
  _recentAgents.value = result.agents
  _recentAgentsLoaded.value = true
  _statusByAgent.update { it + result.agents.associateBy { a -> a.agentId } }
  hooks.agentsSeen(result.agents.map { it.agentId })
}

/** A session no project lists, by id, so a screen can open it. Older hosts don't know the method. */
suspend fun HostStore.adoptSession(id: String) {
  val backend = backend ?: return
  val session = runCatching { backend.request(Commands.GetSession, CommandsTypes.GetSessionParams(id)) }.getOrNull() ?: return
  val remote = runCatching {
    ProtocolJson.decode(RemoteSession.serializer(), ProtocolJson.encode(Commands.GetSession.result, session))
  }.getOrNull() ?: return
  _adoptedSessions.update { it + (id to remote) }
}

suspend fun HostStore.loadScratchPads() {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.ScratchPadsList, MethodsTypes.ScratchPadsListParams()) }.getOrNull() ?: return
  _scratchPads.value = result.sessions
}

/** Runners an agent can be started on; host-wide, so loaded once and shared. */
suspend fun HostStore.loadRunners() {
  if (_runners.value.isEmpty()) reloadRunners()
}

/** The list again, after a runner's CLI was installed or signed in to. */
suspend fun HostStore.reloadRunners() {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.AutomationsRunners, MethodsTypes.AutomationsRunnersParams()) }.getOrNull() ?: return
  _runners.value = result.runners
}

/** What a runner's CLI last reported: a start's models before any agent has run. Null is the default runner. */
fun HostStore.lastKnownModels(runnerId: String?): List<RemoteModelInfo> =
  _runners.value.firstOrNull { it.id == (runnerId ?: DEFAULT_RUNNER) }?.reportedModels.orEmpty()

/** Whether an agent's runner can rewind and fork; unknown runners and older hosts count as able. */
fun HostStore.supportsTranscriptFork(agentId: String) = runner(agentId)?.supportsTranscriptFork ?: true

/** Whether an agent's runner takes side questions; unknown counts as able. */
fun HostStore.supportsSideQuestion(agentId: String) = runner(agentId)?.supportsSideQuestion ?: true

private fun HostStore.runner(agentId: String): RemoteRunner? {
  val id = _statusByAgent.value[agentId]?.runnerId ?: DEFAULT_RUNNER
  return _runners.value.firstOrNull { it.id == id }
}

internal const val DEFAULT_RUNNER = "claude-code"

/** Backstop for a change nothing announced: refetch the projects and every session list held. */
suspend fun HostStore.refreshHeldLists() {
  refreshProjects()
  reloadSessions(null)
}

/** Answer `sessions.changed`: a named repo reloads just that one, null reloads everything held. */
suspend fun HostStore.reloadSessions(repoRoot: String?) {
  if (repoRoot == null) {
    for (known in _sessionsByRepo.value.keys.toList()) loadSessions(known)
    return
  }
  // A repo this app never listed has nothing to refresh.
  if (repoRoot !in _sessionsByRepo.value) return
  loadSessions(repoRoot)
}

suspend fun HostStore.loadSessions(repoRoot: String) {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.SessionsList, MethodsTypes.SessionsListParams(repoRoot)) }.getOrNull() ?: return
  // The host leaves a session out while its worktree is being made; one created here stays in view until listed.
  val listed = result.sessions.map { it.id }.toSet()
  creatingSessions.keys.removeAll { it in listed }
  val creating = creatingSessions.values.filter { it.repoRoot == repoRoot }
  val previous = _sessionsByRepo.value[repoRoot].orEmpty()
  _sessionsByRepo.update { it + (repoRoot to (creating + result.sessions)) }
  refreshGitStatusOnBranchChange(previous, result.sessions)
}

/** A checkout switched outside Argus: the cached status describes the old branch until re-read. */
private suspend fun HostStore.refreshGitStatusOnBranchChange(previous: List<RemoteSession>, current: List<RemoteSession>) {
  val before = previous.associate { it.id to it.branch }
  for (session in current) {
    val old = before[session.id] ?: continue
    if (session.id in _gitStatusBySession.value && old != session.branch) loadGitStatus(session.id)
  }
}

suspend fun HostStore.loadAgents(repoRoot: String) {
  val backend = backend ?: return
  if (holdsFresher(repoRoot in _agentsByRepo.value)) return
  // The host refuses a repo it has no project for, which a scratch pad's or a run's folder never is.
  val params = sessionOutsideProjects(repoRoot)?.let { MethodsTypes.AgentsListParams(sessionId = it.id) }
    ?: MethodsTypes.AgentsListParams(repoRoot = repoRoot)
  val result = runCatching { backend.request(Methods.AgentsList, params) }.getOrNull() ?: return
  _agentsByRepo.update { it + (repoRoot to result.agents) }
  _statusByAgent.update { it + result.agents.associateBy { a -> a.agentId } }
}

suspend fun HostStore.loadStoppedAgents(repoRoot: String) {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.AgentsStopped, MethodsTypes.AgentsStoppedParams(repoRoot)) }.getOrNull() ?: return
  _stoppedByRepo.update { it + (repoRoot to result.agents) }
}

suspend fun HostStore.loadAgentStatus(agentId: String) {
  val backend = backend ?: return
  if (holdsFresher(agentId in _statusByAgent.value)) return
  try {
    val result = backend.request(Methods.AgentsStatus, MethodsTypes.AgentsStatusParams(agentId))
    _statusByAgent.update { it + (agentId to result.agent) }
    _goneAgents.update { it - agentId }
  } catch (e: TransportException.Gateway) {
    if (e.payload.isNotFound) _goneAgents.update { it + agentId }
  } catch (_: Exception) {
  }
}

suspend fun HostStore.refreshDevices() {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.DevicesList, MethodsTypes.DevicesListParams()) }.getOrNull() ?: return
  _devices.value = result.devices
  _devicesLoaded.value = true
}

/** Device hosts can only be added or removed on the computer itself. */
suspend fun HostStore.refreshDeviceHosts() {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.DeviceHostsList, MethodsTypes.DeviceHostsListParams()) }.getOrNull() ?: return
  _deviceHosts.value = result.hosts
}

// Transcript

/** A stopped agent has no agent id; this stand-in key lets one transcript pipeline serve both. */
fun HostStore.Companion.stoppedKey(repoRoot: String, historyId: String) = "stopped:$historyId\n$repoRoot"

data class StoppedKey(val historyId: String, val repoRoot: String)

fun HostStore.Companion.parseStoppedKey(key: String): StoppedKey? {
  if (!key.startsWith("stopped:")) return null
  val parts = key.removePrefix("stopped:").split("\n")
  if (parts.size != 2 || parts[0].isEmpty() || parts[1].isEmpty()) return null
  return StoppedKey(parts[0], parts[1])
}

suspend fun HostStore.loadTranscript(agentId: String, before: Long? = null) {
  val key = agentId
  val backend = backend ?: return
  if (holdsFresher(before == null && key in _messagesByAgent.value)) return

  val stopped = HostStore.parseStoppedKey(key)
  val transcript: RemoteTranscript
  if (stopped != null) {
    // A saved chat always has messages, so a failure is said rather than shown empty.
    try {
      val r = backend.request(
        Methods.AgentsStoppedTranscript,
        MethodsTypes.AgentsStoppedTranscriptParams(stopped.repoRoot, stopped.historyId, before = before, limit = HostStore.TRANSCRIPT_PAGE),
      )
      transcript = RemoteTranscript(r.messages, prevBefore = r.prevBefore, total = r.total, model = r.model)
      _transcriptErrorByAgent.update { it - key }
    } catch (e: Exception) {
      _transcriptErrorByAgent.update { it + (key to HostStore.stoppedTranscriptFailure(e)) }
      return
    }
  } else {
    // A tail page re-establishes where deltas line up; those arriving meanwhile wait for it.
    val isTail = before == null
    if (isTail) tailFetchStarted(key)
    var page = RemoteTranscript.EMPTY
    try {
      val r = backend.request(Methods.AgentsTranscript, MethodsTypes.AgentsTranscriptParams(key, before = before, limit = HostStore.TRANSCRIPT_PAGE))
      page = RemoteTranscript(r.messages, r.prevBefore, r.total, r.tasks, r.todos, r.followUps, r.model, r.pendingToolName, r.epoch, r.revision)
      _transcriptErrorByAgent.update { it - key }
    } catch (e: TransportException) {
      // A timeout says nothing about the chat being empty.
      if (e.isTransient && key !in _messagesByAgent.value) {
        _transcriptErrorByAgent.update { it + (key to HostStore.describe(e)) }
        if (isTail) tailFetchLanded(key, RemoteTranscript.EMPTY)
        return
      }
    } catch (_: Exception) {
      // A live agent that hasn't started yet should show an empty state, not a spinner forever.
    }
    if (isTail) {
      if (!isStale(page, key)) {
        replaceIfNewEpoch(page, key)
        merge(page, key, isOlderPage = false)
      }
      tailFetchLanded(key, page)
      return
    }
    transcript = page
  }
  merge(transcript, key, isOlderPage = before != null)
}

/** Hosts up to 0.68 only read saved chats inside a project. */
internal fun HostStore.Companion.stoppedTranscriptFailure(error: Throwable): String {
  if (error is TransportException.Gateway && error.payload.isNotFound && "repo_root" in error.payload.message) {
    return "Reading chats saved outside a project needs a newer version of Argus on the host."
  }
  return describe(error)
}

/** Merge a page into the cache, keeping unchanged elements so lists don't rebuild rows on every poll. */
private fun HostStore.merge(transcript: RemoteTranscript, key: String, isOlderPage: Boolean) {
  val existing = _messagesByAgent.value[key].orEmpty()
  var merged = if (isOlderPage) {
    // Older page: prepend anything not already held.
    val known = existing.map { it.id }.toSet()
    transcript.messages.filterNot { it.id in known } + existing
  } else {
    // Tail page: keep older pages already loaded, replace the tail.
    val incoming = transcript.messages.map { it.id }.toSet()
    val firstIncoming = transcript.messages.firstOrNull()?.id
    existing.takeWhile { it.id != firstIncoming && it.id !in incoming } + transcript.messages
  }
  val previousById = existing.associateBy { it.id }
  merged = merged.map { m -> previousById[m.id]?.takeIf { it == m } ?: m }
  if (merged != existing || key !in _messagesByAgent.value) _messagesByAgent.update { it + (key to merged) }

  reconcileOptimistic(key, merged)

  transcript.tasks?.let { tasks -> _tasksByAgent.update { it + (key to tasks) } }
  transcript.todos?.let { todos -> _todosByAgent.update { it + (key to todos) } }
  if (!isOlderPage) setFollowUps(transcript.followUps, key)
  _pendingToolByAgent.update { it.with(key, transcript.pendingToolName) }

  // Only the first load sets where "older" starts; scrolling up walks the cursor back from there.
  if (isOlderPage || key !in _prevBeforeByAgent.value) _prevBeforeByAgent.update { it.with(key, transcript.prevBefore) }
}

/** Drop an optimistic bubble once the server echoes it back; the echo may carry a preamble, so "contains". */
internal fun HostStore.reconcileOptimistic(key: String, messages: List<RemoteMessage>) {
  val pending = _optimisticByAgent.value[key]?.takeIf { it.isNotEmpty() } ?: return
  val serverUserText = messages.filter { it.role == RemoteMessageRole.user }.map { it.textBlocks.joinToString("\n") }
  val remaining = pending.filter { optimistic ->
    val typed = optimistic.textBlocks.joinToString("\n").trim()
    typed.isNotEmpty() && serverUserText.none { it.contains(typed) }
  }
  if (remaining.size != pending.size) _optimisticByAgent.update { it.with(key, remaining.ifEmpty { null }) }
}

suspend fun HostStore.loadOlderMessages(agentId: String) {
  val cursor = _prevBeforeByAgent.value[agentId] ?: return
  loadTranscript(agentId, before = cursor)
}

/** Messages to render: the server's, then anything still in flight. */
fun HostStore.visibleMessages(key: String): List<RemoteMessage> =
  _messagesByAgent.value[key].orEmpty() + _optimisticByAgent.value[key].orEmpty()

/** Whether a first page has come back, so an empty chat can be told from one still loading. */
fun HostStore.hasLoadedTranscript(key: String) = key in _messagesByAgent.value

fun HostStore.hasOlderMessages(key: String) = key in _prevBeforeByAgent.value

// Images

/** Locally seeded attachments carry their bytes and have no server-side id; asking for one can only fail. */
fun HostStore.Companion.isLocallySeeded(imageId: String) = ":img:" in imageId

suspend fun HostStore.loadImage(agentId: String, imageId: String) {
  if (HostStore.isLocallySeeded(imageId)) return
  val cacheKey = imageKey(agentId, imageId)
  if (cacheKey in _imageCache.value) return
  val backend = backend ?: return
  val stopped = HostStore.parseStoppedKey(agentId)
  val dataUri = runCatching {
    if (stopped != null) {
      backend.request(Methods.AgentsStoppedImage, MethodsTypes.AgentsStoppedImageParams(stopped.repoRoot, stopped.historyId, imageId))
        .let { "data:${it.mediaType};base64,${it.data}" }
    } else {
      backend.request(Methods.AgentsImage, MethodsTypes.AgentsImageParams(agentId, imageId)).let { "data:${it.mediaType};base64,${it.data}" }
    }
  }.getOrNull() ?: return
  _imageCache.update { it + (cacheKey to dataUri) }
}

fun HostStore.cachedImage(agentId: String, imageId: String): String? = _imageCache.value[imageKey(agentId, imageId)]

/** Seed the cache directly, so an optimistic bubble shows its attachments before any round trip. */
fun HostStore.seedImage(agentId: String, imageId: String, dataUri: String) {
  _imageCache.update { it + (imageKey(agentId, imageId) to dataUri) }
}

// Subscriptions

suspend fun HostStore.watchAgent(key: String, on: Boolean) {
  // A stopped agent has no live process to subscribe to.
  if (HostStore.parseStoppedKey(key) != null) return
  if (on) watchedAgents += key else watchedAgents -= key
  backend?.subscribe(key, on)
}

// Git

suspend fun HostStore.loadGitStatus(sessionId: String) {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.SessionsGitStatus, MethodsTypes.SessionsGitStatusParams(sessionId)) }.getOrNull() ?: return
  // Every row reads this map; an unchanged write re-lays them all out.
  if (_gitStatusBySession.value[sessionId] == result.status) return
  _gitStatusBySession.update { it + (sessionId to result.status) }
}

/** Re-reads a status something already shows, once per burst: a push rewrites refs in several steps. */
suspend fun HostStore.refreshGitStatus(sessionId: String) {
  if (sessionId !in _gitStatusBySession.value) return
  if (!gitStatusLoading.add(sessionId)) {
    gitStatusStale += sessionId
    return
  }
  try {
    do {
      gitStatusStale -= sessionId
      loadGitStatus(sessionId)
    } while (sessionId in gitStatusStale)
  } finally {
    gitStatusLoading -= sessionId
  }
}

/** A fetch or push moves remote-tracking refs every checkout of the repo compares to. */
suspend fun HostStore.refreshGitStatuses(repoRoot: String) {
  for (session in _sessionsByRepo.value[repoRoot].orEmpty()) refreshGitStatus(session.id)
}

/** Throws rather than answering "", which would read as "no changes". */
suspend fun HostStore.loadDiff(sessionId: String, mode: String, checkpointId: String? = null): String {
  val backend = backend ?: return ""
  return backend.request(Methods.SessionsDiff, MethodsTypes.SessionsDiffParams(sessionId, MethodsTypes.SessionsDiffParamsMode(mode), checkpointId)).diff
}

/** The session's agent turns that can still be diffed, oldest first. */
suspend fun HostStore.loadSessionTurns(sessionId: String): List<RemoteSessionTurn> {
  val backend = backend ?: return emptyList()
  return backend.request(Methods.SessionsTurns, MethodsTypes.SessionsTurnsParams(sessionId)).turns
}

suspend fun HostStore.listBranches(sessionId: String): List<RemoteGitBranch> {
  val backend = backend ?: return emptyList()
  return runCatching { backend.request(Methods.SessionsBranches, MethodsTypes.SessionsBranchesParams(sessionId)).branches }.getOrDefault(emptyList())
}

// Prompts

/**
 * Whether a tool call is still waiting on a decision. The live prompt is trusted
 * over the snapshot; a local answer wins over both, so the form clears at once.
 */
fun HostStore.isToolCallPending(agentKey: String, call: RemoteToolCall): Boolean {
  if (promptKey(agentKey, call.id) in _answered.value) return false
  if (call.expired == true) return false
  // A stopped agent's last call can't be answered any more.
  val state = _statusByAgent.value[agentKey]?.status
  if (state == RemoteAgentStatusStatus.stopped || state == RemoteAgentStatusStatus.error) return false
  if (promptKey(agentKey, call.id) in _prompts.value) return true
  return call.status == RemoteToolCallStatus.pending || call.pendingPermission == true
}

/** The call or anything a sub-agent ran under it is waiting on a decision. */
fun HostStore.hasPendingCall(agentKey: String, call: RemoteToolCall): Boolean {
  if (isToolCallPending(agentKey, call)) return true
  return call.children.orEmpty().any { it is RemoteToolCallChild.ToolUse && hasPendingCall(agentKey, it.value.toolCall) }
}

/** The prompt backing a pending call, when the gateway has forwarded one. */
fun HostStore.prompt(agentKey: String, toolUseId: String): RemotePermissionRequest? = _prompts.value[promptKey(agentKey, toolUseId)]
