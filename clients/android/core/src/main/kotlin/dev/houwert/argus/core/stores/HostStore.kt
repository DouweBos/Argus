package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.backend.HostEvent
import dev.houwert.argus.core.backend.toStored
import dev.houwert.argus.core.devices.DeviceInputQueue
import dev.houwert.argus.core.devices.MediaRouter
import dev.houwert.argus.core.offline.Outbox
import dev.houwert.argus.core.offline.SavedAnswers
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.EventEnvelope
import dev.houwert.argus.kit.protocol.generated.Events
import dev.houwert.argus.kit.protocol.generated.RemoteAgentCapabilities
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeAccount
import dev.houwert.argus.kit.protocol.generated.RemoteClaudeLoginState
import dev.houwert.argus.kit.protocol.generated.RemoteDevice
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceClaimState
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceHost
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceState
import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemotePermissionRequest
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteQueuedMessage
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.generated.RemoteTask
import dev.houwert.argus.kit.protocol.generated.RemoteTodo
import dev.houwert.argus.kit.protocol.generated.RunnerAccount
import dev.houwert.argus.kit.protocol.isOutsideProjects
import dev.houwert.argus.kit.storage.RemoteEndpoint
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException

/**
 * One computer's data and every action on it, over whichever [HostBackend]
 * reaches it. Screens collect the `StateFlow` slices and call the actions; the
 * backend pushes events back in through [handle].
 *
 * The store outlives its backend: the app [attach]es a fresh one on every
 * connect and [reset]s when it moves to another computer.
 *
 * Threading: every mutation runs on [scope]'s dispatcher, which must be
 * single-threaded (the main dispatcher in the app, a test dispatcher in tests);
 * call the suspend actions from that dispatcher too.
 */
class HostStore(
  internal val scope: CoroutineScope,
  var hooks: HostStoreHooks = HostStoreHooks(),
) {
  // Connection

  internal val _connection = MutableStateFlow(Transport.State.Offline)
  val connection: StateFlow<Transport.State> = _connection.asStateFlow()

  /** This device's grants: seeded from the pairing, refreshed on connect. */
  internal val _capabilities = MutableStateFlow(emptyList<String>())
  val capabilities: StateFlow<List<String>> = _capabilities.asStateFlow()
  fun setCapabilities(value: List<String>) { _capabilities.value = value }
  val hasControl: Boolean get() = "control" in _capabilities.value

  // Per-host data

  internal val _projects = MutableStateFlow(emptyList<RemoteProject>())
  val projects: StateFlow<List<RemoteProject>> = _projects.asStateFlow()
  /** Until loaded, an empty list means "not known", not "none". */
  internal val _projectsLoaded = MutableStateFlow(false)
  val projectsLoaded: StateFlow<Boolean> = _projectsLoaded.asStateFlow()
  internal val _recentAgentsLoaded = MutableStateFlow(false)
  val recentAgentsLoaded: StateFlow<Boolean> = _recentAgentsLoaded.asStateFlow()
  internal val _devicesLoaded = MutableStateFlow(false)
  val devicesLoaded: StateFlow<Boolean> = _devicesLoaded.asStateFlow()
  internal val _sessionsByRepo = MutableStateFlow(emptyMap<String, List<RemoteSession>>())
  val sessionsByRepo: StateFlow<Map<String, List<RemoteSession>>> = _sessionsByRepo.asStateFlow()
  internal val _agentsByRepo = MutableStateFlow(emptyMap<String, List<RemoteAgentStatus>>())
  val agentsByRepo: StateFlow<Map<String, List<RemoteAgentStatus>>> = _agentsByRepo.asStateFlow()
  /** Every agent across every project, for Home's recent agents. */
  internal val _recentAgents = MutableStateFlow(emptyList<RemoteAgentStatus>())
  val recentAgents: StateFlow<List<RemoteAgentStatus>> = _recentAgents.asStateFlow()
  /** Sessions that belong to no project, each in its own directory. */
  internal val _scratchPads = MutableStateFlow(emptyList<RemoteSession>())
  val scratchPads: StateFlow<List<RemoteSession>> = _scratchPads.asStateFlow()
  /** Sessions outside every project, fetched by id (an automation run's). */
  internal val _adoptedSessions = MutableStateFlow(emptyMap<String, RemoteSession>())
  val adoptedSessions: StateFlow<Map<String, RemoteSession>> = _adoptedSessions.asStateFlow()
  /** LLM runners this computer has registered, for the spawn sheet's picker. */
  internal val _runners = MutableStateFlow(emptyList<RemoteRunner>())
  val runners: StateFlow<List<RemoteRunner>> = _runners.asStateFlow()
  internal val _stoppedByRepo = MutableStateFlow(emptyMap<String, List<RemoteStoppedAgent>>())
  val stoppedByRepo: StateFlow<Map<String, List<RemoteStoppedAgent>>> = _stoppedByRepo.asStateFlow()
  /** Stopped agents a link already resumed, so opening it again doesn't resume a second copy. */
  internal val resumedAs = mutableMapOf<String, String>()
  internal val _messagesByAgent = MutableStateFlow(emptyMap<String, List<RemoteMessage>>())
  val messagesByAgent: StateFlow<Map<String, List<RemoteMessage>>> = _messagesByAgent.asStateFlow()
  /** Locally appended user messages awaiting confirmation in the next snapshot. */
  internal val _optimisticByAgent = MutableStateFlow(emptyMap<String, List<RemoteMessage>>())
  val optimisticByAgent: StateFlow<Map<String, List<RemoteMessage>>> = _optimisticByAgent.asStateFlow()
  /** Messages that never reached the computer, kept so a retry re-sends them. */
  internal val _failedByAgent = MutableStateFlow(emptyMap<String, List<FailedSend>>())
  val failedByAgent: StateFlow<Map<String, List<FailedSend>>> = _failedByAgent.asStateFlow()
  /** The computer's queue per agent: messages waiting on a busy agent. */
  internal val _queuedByAgent = MutableStateFlow(emptyMap<String, List<RemoteQueuedMessage>>())
  val queuedByAgent: StateFlow<Map<String, List<RemoteQueuedMessage>>> = _queuedByAgent.asStateFlow()
  /** Queue adds still in flight; separate because a queue event can replace the list first. */
  internal val _sendingQueuedByAgent = MutableStateFlow(emptyMap<String, List<RemoteQueuedMessage>>())
  val sendingQueuedByAgent: StateFlow<Map<String, List<RemoteQueuedMessage>>> = _sendingQueuedByAgent.asStateFlow()
  internal val _tasksByAgent = MutableStateFlow(emptyMap<String, List<RemoteTask>>())
  val tasksByAgent: StateFlow<Map<String, List<RemoteTask>>> = _tasksByAgent.asStateFlow()
  internal val _todosByAgent = MutableStateFlow(emptyMap<String, List<RemoteTodo>>())
  val todosByAgent: StateFlow<Map<String, List<RemoteTodo>>> = _todosByAgent.asStateFlow()
  /** Replies suggested once each agent's last turn ended; absent when none. */
  internal val _followUpsByAgent = MutableStateFlow(emptyMap<String, List<String>>())
  val followUpsByAgent: StateFlow<Map<String, List<String>>> = _followUpsByAgent.asStateFlow()
  /** Name of the tool currently executing per agent; drives the activity row. */
  internal val _pendingToolByAgent = MutableStateFlow(emptyMap<String, String>())
  val pendingToolByAgent: StateFlow<Map<String, String>> = _pendingToolByAgent.asStateFlow()
  /** Cursor for the next older page per agent; absent means the start is reached. */
  internal val _prevBeforeByAgent = MutableStateFlow(emptyMap<String, Long>())
  val prevBeforeByAgent: StateFlow<Map<String, Long>> = _prevBeforeByAgent.asStateFlow()
  /** Why a transcript couldn't be read, so it isn't mistaken for an empty one. */
  internal val _transcriptErrorByAgent = MutableStateFlow(emptyMap<String, String>())
  val transcriptErrorByAgent: StateFlow<Map<String, String>> = _transcriptErrorByAgent.asStateFlow()
  internal val _gitStatusBySession = MutableStateFlow(emptyMap<String, RemoteGitStatus>())
  val gitStatusBySession: StateFlow<Map<String, RemoteGitStatus>> = _gitStatusBySession.asStateFlow()
  /** Sessions this client merged into their base, so their cards can offer deleting them. */
  internal val _mergedSessionIds = MutableStateFlow(emptySet<String>())
  val mergedSessionIds: StateFlow<Set<String>> = _mergedSessionIds.asStateFlow()
  /** Live permission prompts by [promptKey]. */
  internal val _prompts = MutableStateFlow(emptyMap<String, RemotePermissionRequest>())
  val prompts: StateFlow<Map<String, RemotePermissionRequest>> = _prompts.asStateFlow()
  /** Prompts this client just answered: clears the inline form before the round trip lands. */
  internal val _answered = MutableStateFlow(emptySet<String>())
  val answered: StateFlow<Set<String>> = _answered.asStateFlow()
  /** Resolved images by [imageKey], as data URIs. */
  internal val _imageCache = MutableStateFlow(emptyMap<String, String>())
  val imageCache: StateFlow<Map<String, String>> = _imageCache.asStateFlow()
  internal val _capabilitiesByAgent = MutableStateFlow(emptyMap<String, RemoteAgentCapabilities>())
  val capabilitiesByAgent: StateFlow<Map<String, RemoteAgentCapabilities>> = _capabilitiesByAgent.asStateFlow()
  /** A start composer's slash commands and models, per session, before its agent exists. */
  internal val _startOptionsBySession = MutableStateFlow(emptyMap<String, RemoteAgentCapabilities>())
  val startOptionsBySession: StateFlow<Map<String, RemoteAgentCapabilities>> = _startOptionsBySession.asStateFlow()
  /** The session this client last said it shows, said again after a reconnect. */
  internal val _viewingSessionId = MutableStateFlow<String?>(null)
  val viewingSessionId: StateFlow<String?> = _viewingSessionId.asStateFlow()
  internal var viewingRunnerId: String? = null
  internal var viewingToken = 0
  internal val _statusByAgent = MutableStateFlow(emptyMap<String, RemoteAgentStatus>())
  val statusByAgent: StateFlow<Map<String, RemoteAgentStatus>> = _statusByAgent.asStateFlow()
  /** Agents the computer no longer has; their transcript can outlive them. */
  internal val _goneAgents = MutableStateFlow(emptySet<String>())
  val goneAgents: StateFlow<Set<String>> = _goneAgents.asStateFlow()
  /** Locally chosen effort per agent; the monitor snapshot doesn't carry it. */
  internal val _effortByAgent = MutableStateFlow(emptyMap<String, String>())
  val effortByAgent: StateFlow<Map<String, String>> = _effortByAgent.asStateFlow()
  internal val _devices = MutableStateFlow(emptyList<RemoteDevice>())
  val devices: StateFlow<List<RemoteDevice>> = _devices.asStateFlow()
  internal val _deviceHosts = MutableStateFlow(emptyList<RemoteDeviceHost>())
  val deviceHosts: StateFlow<List<RemoteDeviceHost>> = _deviceHosts.asStateFlow()
  /** Null until the first load: an empty list would read as signed out everywhere. */
  internal val _claudeAccounts = MutableStateFlow<List<RemoteClaudeAccount>?>(null)
  val claudeAccounts: StateFlow<List<RemoteClaudeAccount>?> = _claudeAccounts.asStateFlow()
  internal val _activeClaudeAccountId = MutableStateFlow<String?>(null)
  val activeClaudeAccountId: StateFlow<String?> = _activeClaudeAccountId.asStateFlow()
  /** Runners besides Claude Code and their sign-in; null until the first load. */
  internal val _runnerAccounts = MutableStateFlow<List<RunnerAccount>?>(null)
  val runnerAccounts: StateFlow<List<RunnerAccount>?> = _runnerAccounts.asStateFlow()
  /** The computer's in-flight Claude sign-in, if any. */
  internal val _claudeLogin = MutableStateFlow<RemoteClaudeLoginState?>(null)
  val claudeLogin: StateFlow<RemoteClaudeLoginState?> = _claudeLogin.asStateFlow()
  /** Fold and orientation for watched devices, by device id. */
  internal val _deviceStates = MutableStateFlow(emptyMap<String, RemoteDeviceState>())
  val deviceStates: StateFlow<Map<String, RemoteDeviceState>> = _deviceStates.asStateFlow()
  /** Who drives each watched device; [connectionId] tells "someone else" from "me". */
  internal val _deviceClaims = MutableStateFlow(emptyMap<String, RemoteDeviceClaimState>())
  val deviceClaims: StateFlow<Map<String, RemoteDeviceClaimState>> = _deviceClaims.asStateFlow()
  internal val _connectionId = MutableStateFlow<String?>(null)
  val connectionId: StateFlow<String?> = _connectionId.asStateFlow()

  /** The most recent error worth showing, if any. */
  internal val _lastError = MutableStateFlow<String?>(null)
  val lastError: StateFlow<String?> = _lastError.asStateFlow()

  /** Offline: when the oldest saved answer on screen was saved (epoch ms); null while live. */
  internal val _savedAsOf = MutableStateFlow<Long?>(null)
  val savedAsOf: StateFlow<Long?> = _savedAsOf.asStateFlow()
  /** Replies waiting for the connection, per agent; see `HostStoreOffline.kt`. */
  internal val _outboxByAgent = MutableStateFlow(emptyMap<String, List<FailedSend>>())
  val outboxByAgent: StateFlow<Map<String, List<FailedSend>>> = _outboxByAgent.asStateFlow()

  /** Binary device-screen frames, for the devices screens to parse. */
  private val _media = MutableSharedFlow<ByteArray>(extraBufferCapacity = 120)
  val media: SharedFlow<ByteArray> = _media
  /** Parsed frames by stream, for `registerMediaSink`; see `devices/HostStoreDevices.kt`. */
  internal val mediaRouter = MediaRouter()
  /** Touches, buttons and keys, sent one at a time in order. */
  internal val deviceInput by lazy { DeviceInputQueue(scope) }

  // Collaborators

  var backend: HostBackend? = null
    internal set
  internal var savedAnswers: SavedAnswers? = null
  internal var outbox: Outbox? = null
  internal var outboxFlushing = false

  private var pump: Job? = null
  /** Sessions created here that the host doesn't list yet (still setting up). */
  internal val creatingSessions = mutableMapOf<String, RemoteSession>()
  /** Debounces transcript refetches: a burst of agent events becomes one call. */
  private val refetchTimers = mutableMapOf<String, Job>()
  internal val transcriptSync = mutableMapOf<String, TranscriptSync>()
  /** The epoch each held transcript was last paged in; survives a reconnect. */
  internal val heldEpochs = mutableMapOf<String, String>()
  internal val tailFetches = mutableMapOf<String, Int>()
  internal val bufferedDeltas = mutableMapOf<String, MutableList<TranscriptDelta>>()
  /** Agents a delta has arrived for since the last connect: their events need no refetch. */
  internal val deltaAgents = mutableSetOf<String>()
  /** Agents a view is showing, so a delta that can't be lined up is worth a refetch. */
  internal val watchedAgents = mutableSetOf<String>()
  internal val gitStatusLoading = mutableSetOf<String>()
  internal val gitStatusStale = mutableSetOf<String>()
  /** Where each agent's applied queue sits among the host's events; see `applyQueue`. */
  internal val queueSeq = mutableMapOf<String, Int>()
  /** Device streams and terminals open on this connection; see [hasConnectionBoundWork]. */
  var connectionBoundWork = 0
  private val eventObservers = linkedMapOf<Int, (EventEnvelope) -> Unit>()
  private var nextObserverId = 0

  // Lifecycle

  /** The app is reaching for a backend; shows as connecting until [attach]. */
  fun beginConnecting() {
    _connection.value = Transport.State.Connecting
  }

  /** Adopt a live backend and start listening to it. */
  fun attach(live: HostBackend) {
    pump?.cancel()
    // An error from while offline is about the connection this one replaces.
    if (_connection.value == Transport.State.Offline) _lastError.value = null
    backend = wrapForOffline(live)
    _connection.value = Transport.State.Ready
    _savedAsOf.value = null
    // A new connection numbers its events from scratch.
    queueSeq.clear()
    val stream = live.events()
    // Event-driven reloads are background refreshes, and what they start inherits it.
    pump = scope.launch { BackgroundRefresh.run { stream.collect { handle(it) } } }
    flushOutbox()
  }

  /** Drop the backend. Data stays until [reset], so a reconnect to the same computer doesn't blank the screen. */
  suspend fun detach() {
    pump?.cancel()
    pump = null
    refetchTimers.values.forEach { it.cancel() }
    refetchTimers.clear()
    forgetTranscriptSync()
    val old = liveBackend
    backend = savedAnswers?.let { offlineBackend(it) }
    _connection.value = Transport.State.Offline
    old?.disconnect()
  }

  /** A connect that never produced a backend. */
  fun connectFailed(message: String) {
    _connection.value = Transport.State.Offline
    _lastError.value = message
  }

  /** Forget everything fetched from the current computer. */
  fun reset() {
    if (liveBackend == null) backend = null
    savedAnswers = null
    outbox = null
    _savedAsOf.value = null
    _outboxByAgent.value = emptyMap()
    creatingSessions.clear()
    _projects.value = emptyList()
    _projectsLoaded.value = false
    _recentAgentsLoaded.value = false
    _devicesLoaded.value = false
    _sessionsByRepo.value = emptyMap()
    _agentsByRepo.value = emptyMap()
    _recentAgents.value = emptyList()
    _scratchPads.value = emptyList()
    _adoptedSessions.value = emptyMap()
    _runners.value = emptyList()
    _stoppedByRepo.value = emptyMap()
    resumedAs.clear()
    _messagesByAgent.value = emptyMap()
    _optimisticByAgent.value = emptyMap()
    _failedByAgent.value = emptyMap()
    _queuedByAgent.value = emptyMap()
    _sendingQueuedByAgent.value = emptyMap()
    queueSeq.clear()
    _tasksByAgent.value = emptyMap()
    _todosByAgent.value = emptyMap()
    _followUpsByAgent.value = emptyMap()
    _pendingToolByAgent.value = emptyMap()
    _prevBeforeByAgent.value = emptyMap()
    _transcriptErrorByAgent.value = emptyMap()
    _gitStatusBySession.value = emptyMap()
    _mergedSessionIds.value = emptySet()
    _prompts.value = emptyMap()
    _answered.value = emptySet()
    _imageCache.value = emptyMap()
    _capabilitiesByAgent.value = emptyMap()
    _startOptionsBySession.value = emptyMap()
    _viewingSessionId.value = null
    viewingRunnerId = null
    _statusByAgent.value = emptyMap()
    _goneAgents.value = emptySet()
    _effortByAgent.value = emptyMap()
    _devices.value = emptyList()
    _deviceHosts.value = emptyList()
    _claudeAccounts.value = null
    _activeClaudeAccountId.value = null
    _claudeLogin.value = null
    _runnerAccounts.value = null
    _deviceStates.value = emptyMap()
    _deviceClaims.value = emptyMap()
    _connectionId.value = null
    mediaRouter.clear()
    _lastError.value = null
    forgetTranscriptSync()
    heldEpochs.clear()
    watchedAgents.clear()
  }

  // Events

  /**
   * Hear every gateway event this store doesn't model itself (terminals, file
   * search, usage, raw `ipc`), after the store has handled it. Returns a remover.
   */
  fun observeEvents(handler: (EventEnvelope) -> Unit): () -> Unit {
    val id = nextObserverId++
    eventObservers[id] = handler
    return { eventObservers.remove(id) }
  }

  internal suspend fun handle(event: HostEvent) {
    when (event) {
      is HostEvent.State -> {
        val state = event.state
        val reconnected = state == Transport.State.Ready && _connection.value != Transport.State.Ready
        val changed = state != _connection.value
        _connection.value = state
        if (changed) hooks.connectionChanged(state)
        if (state == Transport.State.Ready) _savedAsOf.value = null
        if (reconnected) {
          flushOutbox()
          resyncTranscripts()
          resyncQueues()
          // The host forgot what a dropped connection was looking at, and its subscriptions.
          scope.launch { sendViewing() }
          for (agentId in watchedAgents) scope.launch { backend?.subscribe(agentId, true) }
        }
      }
      is HostEvent.Media -> {
        mediaRouter.deliver(event.data)
        _media.tryEmit(event.data)
      }
      is HostEvent.Event -> handle(event.envelope)
    }
  }

  internal fun handle(envelope: EventEnvelope) {
    when (envelope.event) {
      Events.HostEndpoints.name -> envelope.decode(Events.HostEndpoints)?.let { payload ->
        hooks.endpointsChanged(payload.endpoints.mapNotNull { it.toStored() })
      }
      Events.PermissionRequest.name -> envelope.decode(Events.PermissionRequest)?.let { request ->
        _prompts.update { it + (promptKey(request.agentId, request.toolUseId) to request) }
        refreshUnlessFollowing(request.agentId)
      }
      Events.PermissionCancel.name -> envelope.decode(Events.PermissionCancel)?.let { cancel ->
        _prompts.update { it - promptKey(cancel.agentId, cancel.toolUseId) }
        refreshUnlessFollowing(cancel.agentId)
      }
      Events.AgentStatus.name -> envelope.decode(Events.AgentStatus)?.let { apply(it) }
      Events.AgentQueue.name -> envelope.decode(Events.AgentQueue)?.let { applyQueue(it.messages, it.agentId, envelope.seq) }
      Events.AgentCapabilities.name -> {
        val agentId = envelope.agentId ?: return
        envelope.decode(Events.AgentCapabilities)?.let { caps -> _capabilitiesByAgent.update { it + (agentId to caps) } }
      }
      // Never rendered raw: it only says the snapshot is stale.
      Events.AgentEvent.name -> envelope.agentId?.let { refreshUnlessFollowing(it) }
      Events.AgentTranscript.name -> envelope.decode(Events.AgentTranscript)?.let { receive(TranscriptDelta.from(it)) }
      Events.DeviceState.name -> envelope.decode(Events.DeviceState)?.let { s -> _deviceStates.update { it + (s.deviceId to s) } }
      Events.DeviceClaim.name -> envelope.decode(Events.DeviceClaim)?.let { c -> _deviceClaims.update { it + (c.deviceId to c) } }
      // Lists are held by the client; a null repo means "refetch whatever you hold".
      Events.SessionsChanged.name -> {
        val repoRoot = envelope.decode(Events.SessionsChanged)?.repoRoot
        scope.launch { reloadSessions(repoRoot) }
      }
      Events.ProjectsChanged.name -> scope.launch { refreshProjects() }
      Events.ClaudeAccountsChanged.name -> envelope.decode(Events.ClaudeAccountsChanged)?.let {
        _claudeAccounts.value = it.accounts
        _activeClaudeAccountId.value = it.activeId
      }
      Events.ClaudeAccountsLogin.name -> envelope.decode(Events.ClaudeAccountsLogin)?.let { _claudeLogin.value = it }
      Events.Notification.name -> envelope.decode(Events.Notification)?.let { hooks.notify(it) }
    }
    eventObservers.values.toList().forEach { it(envelope) }
  }

  private fun apply(status: RemoteAgentStatus) {
    _statusByAgent.update { it + (status.agentId to status) }
    _agentsByRepo.update { byRepo ->
      byRepo.mapValues { (_, agents) -> agents.map { if (it.agentId == status.agentId) status else it } }
    }
    _recentAgents.update { agents ->
      if (agents.any { it.agentId == status.agentId }) agents.map { if (it.agentId == status.agentId) status else it }
      else listOf(status) + agents
    }
    hooks.agentsSeen(listOf(status.agentId))
  }

  fun promptKey(agentId: String, toolUseId: String) = "$agentId:$toolUseId"

  fun imageKey(agentId: String, imageId: String) = "$agentId:$imageId"

  /** A burst of events becomes one refetch: the snapshot is the truth, the events only say it moved. */
  internal fun scheduleTranscriptRefresh(agentId: String) {
    refetchTimers[agentId]?.cancel()
    refetchTimers[agentId] = scope.launch {
      delay(300)
      loadTranscript(agentId)
    }
  }

  // Lookups

  /** The repo a session belongs to; falls back to the agent's project name, and gives up rather than guessing. */
  fun repoRoot(forSessionId: String): String? {
    _sessionsByRepo.value.entries.firstOrNull { (_, sessions) -> sessions.any { it.id == forSessionId } }?.let { return it.key }
    (_scratchPads.value.firstOrNull { it.id == forSessionId } ?: _adoptedSessions.value[forSessionId])?.let { return it.repoRoot }
    val projectName = _statusByAgent.value.values.firstOrNull { it.sessionId == forSessionId }?.projectName ?: return null
    return _projects.value.firstOrNull { it.name == projectName }?.repoRoot
  }

  /** A scratch pad or automation run working in [repoRoot], its own folder. */
  fun sessionOutsideProjects(repoRoot: String): RemoteSession? =
    (_scratchPads.value + _adoptedSessions.value.values).firstOrNull { it.isOutsideProjects && it.repoRoot == repoRoot }

  /** Any session this store holds: a project's, a scratch pad, or one adopted by id. */
  fun session(id: String): RemoteSession? =
    _sessionsByRepo.value.values.flatten().firstOrNull { it.id == id }
      ?: _scratchPads.value.firstOrNull { it.id == id }
      ?: _adoptedSessions.value[id]

  /** Where a session works, as a person reads it; a run's folder is named by its id, no name to show. */
  fun placeName(session: RemoteSession): String = when (session.kind) {
    RemoteSessionKind.scratchPad -> "Scratch pad"
    RemoteSessionKind.automationHost -> "Automation"
    else -> _projects.value.firstOrNull { it.repoRoot == session.repoRoot }?.name ?: session.repoRoot.trimEnd('/').substringAfterLast('/')
  }

  // Error surface

  fun report(error: Throwable, scope: String = "app") {
    if (isQuiet(error)) return
    _lastError.value = describe(error)
    hooks.errorReported(error, scope)
  }

  /** Put a message in front of the user without an underlying error. */
  fun showError(message: String) { _lastError.value = message }

  fun clearError() { _lastError.value = null }

  companion object {
    const val TRANSCRIPT_PAGE = 80L

    /** A task cancelled by a disappearing screen or a newer refresh: never the user's problem. */
    fun isCancellation(error: Throwable) = error is CancellationException

    /** The connection failed rather than the request. */
    fun isTransient(error: Throwable): Boolean = when (error) {
      is TransportException -> error.isTransient
      is IOException -> true
      else -> false
    }

    /** Nothing to tell anyone: cancelled, or a background refresh that lost its connection. */
    fun isQuiet(error: Throwable) = isCancellation(error) || (BackgroundRefresh.isActive && isTransient(error))

    /** The method a host too old for this client lacked; expected skew, counted rather than reported. */
    fun unsupportedMethod(error: Throwable): String? = (error as? TransportException.Unsupported)?.method

    /** A description worth showing; a decoding failure names what drifted rather than "couldn't be read". */
    fun describe(error: Throwable): String = when (error) {
      is TransportException -> error.message ?: "Not connected to a computer."
      is SerializationException -> "Unexpected reply: ${error.message?.lineSequence()?.firstOrNull() ?: "unreadable"}"
      else -> error.message ?: error.toString()
    }

    /** Thrown by actions that need a connection when there is none. */
    val offlineError get() = TransportException.NotReady()
  }
}
