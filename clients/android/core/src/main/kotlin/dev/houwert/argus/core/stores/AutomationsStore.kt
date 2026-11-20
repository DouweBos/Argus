package dev.houwert.argus.core.stores

import dev.houwert.argus.core.automations.AutomationInput
import dev.houwert.argus.core.automations.newAutomationDetail
import dev.houwert.argus.core.backend.requestWithNulls
import dev.houwert.argus.kit.protocol.generated.AutomationCalibration
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAutomation
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetailTriggerKind
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationGuardrails
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationRun
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import dev.houwert.argus.kit.protocol.generated.RemoteSignalSource
import java.util.TimeZone
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive

/**
 * The connected computer's automations, their runs and each run's report.
 * Cleared whenever the active computer changes: none of it belongs to the next one.
 */
class AutomationsStore(val host: HostStore) {
  internal val _automations = MutableStateFlow(emptyList<RemoteAutomation>())
  val automations: StateFlow<List<RemoteAutomation>> = _automations.asStateFlow()
  internal val _detailById = MutableStateFlow(emptyMap<String, RemoteAutomationDetail>())
  val detailById: StateFlow<Map<String, RemoteAutomationDetail>> = _detailById.asStateFlow()
  /** Keyed by automation id; loaded when an automation is opened. */
  internal val _memoriesById = MutableStateFlow(emptyMap<String, List<RemoteAutomationMemory>>())
  val memoriesById: StateFlow<Map<String, List<RemoteAutomationMemory>>> = _memoriesById.asStateFlow()
  internal val _sources = MutableStateFlow(emptyList<RemoteSignalSource>())
  val sources: StateFlow<List<RemoteSignalSource>> = _sources.asStateFlow()
  internal val _runners = MutableStateFlow(emptyList<RemoteRunner>())
  val runners: StateFlow<List<RemoteRunner>> = _runners.asStateFlow()
  /** Newest first, across every automation. */
  internal val _runs = MutableStateFlow(emptyList<RemoteAutomationRun>())
  val runs: StateFlow<List<RemoteAutomationRun>> = _runs.asStateFlow()
  /** Ad-hoc runs only, newest first; null until the Quick Run screen asks. */
  internal val _quickRuns = MutableStateFlow<List<RemoteAutomationRun>?>(null)
  val quickRuns: StateFlow<List<RemoteAutomationRun>?> = _quickRuns.asStateFlow()
  internal val _detailByRun = MutableStateFlow(emptyMap<String, MethodsTypes.AutomationsRunResult>())
  val detailByRun: StateFlow<Map<String, MethodsTypes.AutomationsRunResult>> = _detailByRun.asStateFlow()
  internal val _triggering = MutableStateFlow(emptySet<String>())
  val triggering: StateFlow<Set<String>> = _triggering.asStateFlow()
  /** Each automation's track record, keyed by automation id. */
  internal val _calibrationById = MutableStateFlow(emptyMap<String, AutomationCalibration>())
  val calibrationById: StateFlow<Map<String, AutomationCalibration>> = _calibrationById.asStateFlow()
  internal val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
  internal val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()

  fun clear() {
    _automations.value = emptyList()
    _detailById.value = emptyMap()
    _memoriesById.value = emptyMap()
    _sources.value = emptyList()
    _runners.value = emptyList()
    _runs.value = emptyList()
    _quickRuns.value = null
    _detailByRun.value = emptyMap()
    _triggering.value = emptySet()
    _calibrationById.value = emptyMap()
    _loaded.value = false
    _error.value = null
  }

  fun clearError() { _error.value = null }

  suspend fun refresh() {
    val backend = host.backend ?: return
    val (listed, ran) = coroutineScope {
      val list = async { runCatching { backend.request(Methods.AutomationsList, MethodsTypes.AutomationsListParams()) }.getOrNull() }
      val recent = async { runCatching { backend.request(Methods.AutomationsRuns, MethodsTypes.AutomationsRunsParams(limit = RUN_LIMIT)) }.getOrNull() }
      list.await() to recent.await()
    }
    // A screen left mid-load answered nothing; settling would read as "none".
    if (listed == null && ran == null && !currentCoroutineContext().isActive) return
    listed?.let { _automations.value = it.automations }
    ran?.let { result ->
      _runs.value = result.runs
      // Anything that now has a run is no longer merely "starting".
      _triggering.update { it - result.runs.map { r -> r.automationId }.toSet() }
    }
    _loaded.value = true
    _error.value = if (listed == null && ran == null) "Couldn't read automations." else null
  }

  val phase: LoadPhase
    get() = LoadPhase.of(_loaded.value, _error.value, _automations.value.isEmpty() && _runs.value.isEmpty())

  // Authoring

  /** The editable shape, fetched only for the automation being opened. */
  suspend fun loadDetail(id: String): RemoteAutomationDetail? {
    val backend = host.backend ?: return null
    val result = runCatching { backend.request(Methods.AutomationsGet, MethodsTypes.AutomationsGetParams(id)) }.getOrNull() ?: return null
    _detailById.update { it + (id to result.automation) }
    return result.automation
  }

  /** Which signal sources this computer can actually answer with. */
  suspend fun loadSources() {
    val backend = host.backend ?: return
    runCatching { backend.request(Methods.AutomationsSources, MethodsTypes.AutomationsSourcesParams()) }
      .onSuccess { _sources.value = it.sources }
  }

  /** Runners an automation can be pinned to; an older host leaves the picker on the current runner. */
  suspend fun loadRunners() {
    val backend = host.backend ?: return
    runCatching { backend.request(Methods.AutomationsRunners, MethodsTypes.AutomationsRunnersParams()) }
      .onSuccess { _runners.value = it.runners }
  }

  /** Create when [id] is null, otherwise patch. Returns the saved automation's id. */
  suspend fun save(id: String?, input: RemoteAutomationDetail): String? =
    persist(id, input, if (id == null) StoreEvent.AutomationAction.Create else StoreEvent.AutomationAction.Save)

  /** A paused copy (same playbook, trigger and projects, no memories or runs) to adapt. */
  suspend fun duplicate(id: String): String? {
    val source = loadDetail(id) ?: run {
      _error.value = "Couldn't read that automation to copy it."
      return null
    }
    return persist(null, source.copy(name = "${source.name} copy", enabled = false), StoreEvent.AutomationAction.Duplicate)
  }

  private suspend fun persist(id: String?, input: RemoteAutomationDetail, action: StoreEvent.AutomationAction): String? {
    val backend = host.backend ?: return null
    return try {
      val detail = if (id != null) {
        backend.requestWithNulls(
          Methods.AutomationsUpdate, MethodsTypes.AutomationsUpdateParams(id, AutomationInput.patch(input)), *AutomationInput.clearablePatchPaths,
        ).detail
      } else {
        backend.request(Methods.AutomationsCreate, MethodsTypes.AutomationsCreateParams(AutomationInput.create(input))).detail
      }
      host.hooks.track(StoreEvent.AutomationEdited(action))
      _detailById.update { it + (detail.id to detail) }
      refresh()
      detail.id
    } catch (e: Exception) {
      fail("Couldn't save that automation", e)
      null
    }
  }

  /** Ask the computer to rewrite a playbook; nothing is saved. Null means it refused. */
  suspend fun revisePlaybook(playbook: String, instruction: String, name: String?): String? {
    val backend = host.backend ?: return null
    return try {
      val result = backend.request(Methods.AutomationsRevisePlaybook, MethodsTypes.AutomationsRevisePlaybookParams(playbook, instruction, name))
      host.hooks.track(StoreEvent.AutomationEdited(StoreEvent.AutomationAction.RevisePlaybook))
      _error.value = null
      result.playbook
    } catch (e: Exception) {
      fail("Couldn't rewrite that playbook", e)
      null
    }
  }

  suspend fun setEnabled(id: String, enabled: Boolean) {
    val backend = host.backend ?: return
    try {
      val updated = backend.request(Methods.AutomationsSetEnabled, MethodsTypes.AutomationsSetEnabledParams(id, enabled)).automation
      host.hooks.track(StoreEvent.AutomationEdited(if (enabled) StoreEvent.AutomationAction.Enable else StoreEvent.AutomationAction.Disable))
      _automations.update { list -> list.map { if (it.id == id) updated else it } }
      _detailById.update { map -> map[id]?.let { map + (id to it.copy(enabled = updated.enabled)) } ?: map }
    } catch (e: Exception) {
      fail("Couldn't change that automation", e)
    }
  }

  suspend fun loadMemories(automationId: String) {
    val backend = host.backend ?: return
    try {
      val memories = backend.request(Methods.AutomationsMemories, MethodsTypes.AutomationsMemoriesParams(automationId)).memories
      _memoriesById.update { it + (automationId to memories) }
    } catch (e: Exception) {
      fail("Couldn't read that automation's memories", e)
    }
  }

  /** Create or overwrite; [previousName] renames the memory it was opened as. */
  suspend fun saveMemory(automationId: String, memory: RemoteAutomationMemory, previousName: String?): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(
        Methods.AutomationsSaveMemory,
        MethodsTypes.AutomationsSaveMemoryParams(
          automationId,
          MethodsTypes.AutomationsSaveMemoryParamsMemory(
            name = memory.name, description = memory.description,
            type = MethodsTypes.AutomationsSaveMemoryParamsMemoryType(memory.type.rawValue), body = memory.body,
            previousName = previousName,
          ),
        ),
      )
      host.hooks.track(StoreEvent.MemoryEdited(StoreEvent.MemoryAction.Save))
      _error.value = null
      loadMemories(automationId)
      true
    } catch (e: Exception) {
      fail("Couldn't save that memory", e)
      false
    }
  }

  suspend fun deleteMemory(automationId: String, name: String): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.AutomationsDeleteMemory, MethodsTypes.AutomationsDeleteMemoryParams(automationId, name))
      host.hooks.track(StoreEvent.MemoryEdited(StoreEvent.MemoryAction.Delete))
      _memoriesById.update { map -> map[automationId]?.let { list -> map + (automationId to list.filter { it.name != name }) } ?: map }
      true
    } catch (e: Exception) {
      fail("Couldn't delete that memory", e)
      false
    }
  }

  suspend fun delete(id: String): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.AutomationsDelete, MethodsTypes.AutomationsDeleteParams(id))
      host.hooks.track(StoreEvent.AutomationEdited(StoreEvent.AutomationAction.Delete))
      _automations.update { list -> list.filter { it.id != id } }
      _detailById.update { it - id }
      true
    } catch (e: Exception) {
      fail("Couldn't delete that automation", e)
      false
    }
  }

  suspend fun loadRun(id: String) {
    val backend = host.backend ?: return
    val detail = runCatching { backend.request(Methods.AutomationsRun, MethodsTypes.AutomationsRunParams(id)) }.getOrNull() ?: return
    _detailByRun.update { it + (id to detail) }
  }

  /** Opening a report marks it read on the computer too, clearing its dot. */
  suspend fun markRunRead(id: String) {
    val backend = host.backend ?: return
    // Silent on failure: a lingering unread dot isn't worth an error over the report.
    runCatching { backend.request(Methods.AutomationsMarkRunRead, MethodsTypes.AutomationsMarkRunReadParams(id)) }
    _runs.update { list -> list.map { if (it.id == id) it.copy(unreadReport = false, reportRead = true) else it } }
    _detailByRun.update { map -> map[id]?.let { map + (id to it.copy(run = it.run.copy(unreadReport = false))) } ?: map }
  }

  /** Dismissing a failure from the inbox is reading it; it asks for no reason. */
  suspend fun dismissRun(id: String) {
    markRunRead(id)
    host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.MarkRead))
  }

  suspend fun runNow(automationId: String) {
    val backend = host.backend ?: return
    _triggering.update { it + automationId }
    try {
      // A refused run comes back as a `skipped` record, which still belongs in the list.
      val run = backend.request(Methods.AutomationsRunNow, MethodsTypes.AutomationsRunNowParams(automationId)).run
      host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.Start))
      _runs.update { listOf(run) + it }
    } catch (e: Exception) {
      fail("Couldn't start that automation", e)
      _triggering.update { it - automationId }
    }
    refresh()
  }

  /** Run a playbook once, with nothing saved behind it. Returns the run id. */
  suspend fun runScratch(
    name: String,
    playbook: String,
    repoRoots: List<String>,
    sourceIds: List<String>,
    model: String?,
    guardrails: RemoteAutomationGuardrails,
  ): String? {
    val backend = host.backend ?: return null
    return try {
      val run = backend.request(
        Methods.AutomationsRunScratch,
        MethodsTypes.AutomationsRunScratchParams(name, playbook, repoRoots, sourceIds, model, guardrails),
      ).run
      host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.StartScratch))
      _runs.update { listOf(run) + it }
      _quickRuns.update { it?.let { list -> listOf(run) + list } }
      refresh()
      run.id
    } catch (e: Exception) {
      fail("Couldn't start that run", e)
      null
    }
  }

  /** "Run later": a quick run saved as an enabled run-once automation. Returns the automation's id. */
  suspend fun scheduleScratch(
    name: String,
    playbook: String,
    repoRoots: List<String>,
    sourceIds: List<String> = emptyList(),
    runAt: String,
    timezone: String = TimeZone.getDefault().id,
  ): String? {
    val backend = host.backend ?: return null
    val detail = newAutomationDetail(
      name = name, enabled = true, triggerKind = RemoteAutomationDetailTriggerKind.once, cron = null, runAt = runAt,
      timezone = timezone, catchUp = true, repoRoots = repoRoots, sourceIds = sourceIds, playbook = playbook,
    )
    return try {
      val result = backend.request(Methods.AutomationsCreate, MethodsTypes.AutomationsCreateParams(AutomationInput.create(detail)))
      host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.ScheduleScratch))
      _detailById.update { it + (result.detail.id to result.detail) }
      refresh()
      result.detail.id
    } catch (e: Exception) {
      fail("Couldn't schedule that run", e)
      null
    }
  }

  /** Keep a one-off: promote it to an automation, saved paused. */
  suspend fun saveScratchRun(runId: String, name: String): String? {
    val backend = host.backend ?: return null
    return try {
      // Paused: a playbook that ran once by hand has no schedule the user has thought about yet.
      val automation = backend.request(
        Methods.AutomationsSaveScratchRun,
        MethodsTypes.AutomationsSaveScratchRunParams(runId = runId, name = name, enabled = false),
      ).automation
      host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.SaveScratch))
      refresh()
      automation.id
    } catch (e: Exception) {
      fail("Couldn't save that run", e)
      null
    }
  }

  /** Argue with a finished report; unless [allowClearing] the rewrite may only add proposals. */
  suspend fun sendRunFeedback(id: String, note: String, allowClearing: Boolean): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.AutomationsRunFeedback, MethodsTypes.AutomationsRunFeedbackParams(id, note, allowClearing))
      host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.Feedback))
      _error.value = null
      loadRun(id)
      true
    } catch (e: Exception) {
      fail("Couldn't send that feedback", e)
      false
    }
  }

  suspend fun cancelRun(id: String) {
    val backend = host.backend ?: return
    host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.Cancel))
    runCatching { backend.request(Methods.AutomationsCancelRun, MethodsTypes.AutomationsCancelRunParams(id)) }
    refresh()
  }

  fun runs(automationId: String): List<RemoteAutomationRun> = _runs.value.filter { it.automationId == automationId }

  /** Show it, and report it: a failure the user sees is one worth knowing about. */
  internal fun fail(summary: String, error: Throwable) {
    if (HostStore.isQuiet(error)) return
    _error.value = "$summary — ${HostStore.describe(error)}"
    host.hooks.errorReported(error, "automations")
  }

  companion object {
    private const val RUN_LIMIT = 40L
  }
}
