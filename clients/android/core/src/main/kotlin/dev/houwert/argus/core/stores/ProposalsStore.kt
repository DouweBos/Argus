package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteProposal
import dev.houwert.argus.kit.protocol.generated.RemoteProposalStatus
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The inbox: what the computer's automations are proposing. Reading is `monitor`;
 * starting and dismissing need `control` (starting builds a worktree, and the
 * dismiss reason is what calibrates the automation).
 */
class ProposalsStore(val host: HostStore) {
  private val _proposals = MutableStateFlow(emptyList<RemoteProposal>())
  val proposals: StateFlow<List<RemoteProposal>> = _proposals.asStateFlow()
  /** The newest proposals in any state, for the inbox's started and cleared groups. */
  private val _recent = MutableStateFlow(emptyList<RemoteProposal>())
  val recent: StateFlow<List<RemoteProposal>> = _recent.asStateFlow()
  private val _busy = MutableStateFlow(emptySet<String>())
  val busy: StateFlow<Set<String>> = _busy.asStateFlow()
  private val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()
  /** Accept requests still waiting on an answer, before any stage is known. */
  private val _requesting = MutableStateFlow(emptySet<String>())
  val requesting: StateFlow<Set<String>> = _requesting.asStateFlow()
  /** Why an accept request itself failed; the host's `startError` covers what goes wrong after. */
  private val _requestErrors = MutableStateFlow(emptyMap<String, String>())
  val requestErrors: StateFlow<Map<String, String>> = _requestErrors.asStateFlow()
  /** Started from this phone and now running, kept until opened or closed. */
  private val _started = MutableStateFlow(emptyList<RemoteProposal>())
  val started: StateFlow<List<RemoteProposal>> = _started.asStateFlow()
  /** Proposals opened on their own screen, decided ones included. */
  private val _detailById = MutableStateFlow(emptyMap<String, RemoteProposal>())
  val detailById: StateFlow<Map<String, RemoteProposal>> = _detailById.asStateFlow()
  /** Started here and still being set up, so a card leaving the pending list isn't read as dismissed elsewhere. */
  private val _starting = MutableStateFlow(emptySet<String>())
  val starting: StateFlow<Set<String>> = _starting.asStateFlow()

  fun clear() {
    _proposals.value = emptyList()
    _recent.value = emptyList()
    _busy.value = emptySet()
    _loaded.value = false
    _error.value = null
    _requesting.value = emptySet()
    _requestErrors.value = emptyMap()
    _started.value = emptyList()
    _starting.value = emptySet()
    _detailById.value = emptyMap()
  }

  fun clearError() { _error.value = null }

  /** What this phone already knows of a proposal, freshest first. */
  fun cached(id: String): RemoteProposal? =
    _detailById.value[id] ?: _proposals.value.firstOrNull { it.id == id } ?: _recent.value.firstOrNull { it.id == id }

  /** One proposal in full; null when it is gone. An older computer falls back to the pending list. */
  suspend fun load(id: String): RemoteProposal? {
    val backend = host.backend ?: return _detailById.value[id]
    try {
      val result = backend.request(Methods.ProposalsGet, MethodsTypes.ProposalsGetParams(id))
      _detailById.update { it + (id to result.proposal) }
    } catch (e: TransportException) {
      if (e is TransportException.Gateway && e.payload.isNotFound) {
        _detailById.update { it - id }
      } else {
        _proposals.value.firstOrNull { it.id == id }?.let { pending -> _detailById.update { it + (id to pending) } }
      }
    } catch (e: Exception) {
      report(e)
    }
    return _detailById.value[id]
  }

  /** Ask the automation to rework it. Returns whether a run started now; null on failure. */
  suspend fun requestRevision(id: String, note: String): Boolean? {
    val backend = host.backend ?: return null
    return busyWhile(id) {
      try {
        val result = backend.request(Methods.ProposalsRequestRevision, MethodsTypes.ProposalsRequestRevisionParams(id, note))
        host.hooks.track(StoreEvent.ProposalHandled(StoreEvent.ProposalAction.RequestRevision))
        _detailById.update { it + (id to result.proposal) }
        refresh()
        result.runStarted
      } catch (e: Exception) {
        fail("Couldn't ask for a revision", e)
        null
      }
    }
  }

  /** The inbox groups. Pending comes from its own list so a busy automation's history can't push a decision out. */
  fun items(runs: List<RemoteAutomationRun>, sessionIds: Set<String>, nowMs: Double = System.currentTimeMillis().toDouble()): InboxItems {
    val pendingIds = _proposals.value.map { it.id }.toSet()
    return InboxItems(
      proposals = _proposals.value + _recent.value.filter { it.id !in pendingIds && it.status != RemoteProposalStatus.pending },
      runs = runs,
      sessionIds = sessionIds,
      now = nowMs,
    )
  }

  suspend fun refresh() {
    val backend = host.backend ?: return
    val failed = coroutineScope {
      // Best effort: without it the inbox still has its decisions.
      val latest = async { runCatching { backend.request(Methods.ProposalsList, MethodsTypes.ProposalsListParams(limit = 100)) }.getOrNull() }
      try {
        val result = backend.request(Methods.ProposalsList, MethodsTypes.ProposalsListParams(status = RemoteProposalStatus.pending))
        _proposals.value = result.proposals
        latest.await()?.let { _recent.value = it.proposals }
        _error.value = null
        null
      } catch (e: Exception) {
        latest.cancel()
        e
      }
    }
    if (failed != null) {
      // A screen left mid-load answered nothing; settling would read as "none".
      if (HostStore.isQuiet(failed)) return
      fail("Couldn't read the inbox", failed)
      _loaded.value = true
      return
    }
    _loaded.value = true
    followStarts()
  }

  /** Keep up with starts made here: a failed one stays pending with its error, a finished one leaves as accepted. */
  private suspend fun followStarts() {
    for (proposal in _proposals.value) {
      // An accept that timed out here may still have got through.
      if (proposal.startStage != null && proposal.id in _requestErrors.value) {
        _requestErrors.update { it - proposal.id }
        _starting.update { it + proposal.id }
      }
      if (proposal.startError != null) _starting.update { it - proposal.id }
    }
    val pendingIds = _proposals.value.map { it.id }.toSet()
    val gone = _starting.value - pendingIds
    val backend = host.backend
    if (gone.isEmpty() || backend == null) return
    // Best effort: a miss is retried on the next refresh.
    val result = runCatching {
      backend.request(Methods.ProposalsList, MethodsTypes.ProposalsListParams(status = RemoteProposalStatus.accepted, limit = 100))
    }.getOrNull() ?: return
    for (id in gone) {
      _starting.update { it - id }
      // Not there means it was dismissed or resolved elsewhere: nothing to open.
      val done = result.proposals.firstOrNull { it.id == id } ?: continue
      if (done.agentId == null || _started.value.any { it.id == id }) continue
      _started.update { it + done }
    }
  }

  /** Whether the card shows progress; a refresh that raced the accept can drop the stage, so the local record counts. */
  fun isStarting(proposal: RemoteProposal): Boolean =
    proposal.id in _requesting.value || proposal.startStage != null ||
      (proposal.id in _starting.value && proposal.startError == null)

  fun closeStarted(id: String) { _started.update { list -> list.filter { it.id != id } } }

  /** Returns the agent when the start finished inside the request; otherwise the card follows its stage. */
  suspend fun accept(id: String, note: String? = null): String? {
    val backend = host.backend ?: return null
    _requesting.update { it + id }
    _requestErrors.update { it - id }
    try {
      val trimmed = note?.trim()?.takeIf { it.isNotEmpty() }
      val result = backend.request(Methods.ProposalsAccept, MethodsTypes.ProposalsAcceptParams(id, trimmed))
      _detailById.update { it + (id to result.proposal) }
      host.hooks.track(StoreEvent.ProposalHandled(StoreEvent.ProposalAction.Accept))
      result.agentId?.let { agentId ->
        _proposals.update { list -> list.filter { it.id != id } }
        return agentId
      }
      _proposals.update { list -> list.map { if (it.id == id) result.proposal else it } }
      _starting.update { it + id }
      return null
    } catch (e: Exception) {
      // Shown on the card rather than the banner: it is about that one.
      _requestErrors.update { it + (id to HostStore.describe(e)) }
      report(e)
      return null
    } finally {
      _requesting.update { it - id }
    }
  }

  suspend fun dismiss(id: String, reason: String?) {
    val backend = host.backend ?: return
    busyWhile(id) {
      try {
        backend.request(Methods.ProposalsDismiss, MethodsTypes.ProposalsDismissParams(id, reason))
        host.hooks.track(StoreEvent.ProposalHandled(StoreEvent.ProposalAction.Dismiss))
      } catch (e: Exception) {
        fail("Couldn't dismiss that proposal", e)
      }
      refresh()
    }
  }

  /** You already did what it asked: the opposite signal from a dismissal. */
  suspend fun resolve(id: String, note: String?) {
    val backend = host.backend ?: return
    busyWhile(id) {
      try {
        backend.request(Methods.ProposalsResolve, MethodsTypes.ProposalsResolveParams(id, note))
        host.hooks.track(StoreEvent.ProposalHandled(StoreEvent.ProposalAction.Resolve))
      } catch (e: Exception) {
        fail("Couldn't mark that proposal done", e)
      }
      refresh()
    }
  }

  suspend fun performCleanup(id: String) {
    val backend = host.backend ?: return
    busyWhile(id) {
      try {
        backend.request(Methods.ProposalsPerformCleanup, MethodsTypes.ProposalsPerformCleanupParams(id))
        host.hooks.track(StoreEvent.ProposalHandled(StoreEvent.ProposalAction.Cleanup))
      } catch (e: Exception) {
        fail("Couldn't run that cleanup", e)
      }
      refresh()
    }
  }

  private suspend fun <T> busyWhile(id: String, block: suspend () -> T): T {
    _busy.update { it + id }
    try {
      return block()
    } finally {
      _busy.update { it - id }
    }
  }

  private fun fail(summary: String, error: Throwable) {
    if (HostStore.isQuiet(error)) return
    _error.value = "$summary — ${HostStore.describe(error)}"
    report(error)
  }

  private fun report(error: Throwable) = host.hooks.errorReported(error, "proposals")
}
