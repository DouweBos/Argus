package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.requestWithNulls
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationMemory
import dev.houwert.argus.kit.protocol.generated.RemoteTeammateTemplate
import dev.houwert.argus.kit.protocol.generated.Teammate
import dev.houwert.argus.kit.protocol.generated.TeammateSummary
import dev.houwert.argus.kit.protocol.generated.TeammateThread
import dev.houwert.argus.kit.protocol.generated.UpdateTeammateInput
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive

/**
 * The connected computer's teammates: who they are, their duties, memories and conversations.
 * Cleared whenever the active computer changes. The host records creates, deletes and messages
 * itself, so nothing here is tracked twice.
 */
class TeammatesStore(val host: HostStore) {
  internal val _teammates = MutableStateFlow(emptyList<TeammateSummary>())
  val teammates: StateFlow<List<TeammateSummary>> = _teammates.asStateFlow()
  /** Identity, soul, duties and memory count, keyed by teammate id; loaded when one is opened. */
  internal val _detailById = MutableStateFlow(emptyMap<String, MethodsTypes.TeammatesGetResult>())
  val detailById: StateFlow<Map<String, MethodsTypes.TeammatesGetResult>> = _detailById.asStateFlow()
  internal val _memoriesById = MutableStateFlow(emptyMap<String, List<RemoteAutomationMemory>>())
  val memoriesById: StateFlow<Map<String, List<RemoteAutomationMemory>>> = _memoriesById.asStateFlow()
  /** Newest first, keyed by teammate id. */
  internal val _threadsById = MutableStateFlow(emptyMap<String, List<TeammateThread>>())
  val threadsById: StateFlow<Map<String, List<TeammateThread>>> = _threadsById.asStateFlow()
  /** Null until the gallery asks. */
  internal val _templates = MutableStateFlow<List<RemoteTeammateTemplate>?>(null)
  val templates: StateFlow<List<RemoteTeammateTemplate>?> = _templates.asStateFlow()
  internal val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
  internal val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()

  fun clear() {
    _teammates.value = emptyList()
    _detailById.value = emptyMap()
    _memoriesById.value = emptyMap()
    _threadsById.value = emptyMap()
    _templates.value = null
    _loaded.value = false
    _error.value = null
  }

  fun clearError() { _error.value = null }

  suspend fun refresh() {
    val backend = host.backend ?: return
    val listed = runCatching { backend.request(Methods.TeammatesList, MethodsTypes.TeammatesListParams()) }.getOrNull()
    // A screen left mid-load answered nothing; settling would read as "none".
    if (listed == null && !currentCoroutineContext().isActive) return
    listed?.let { _teammates.value = it.teammates }
    _loaded.value = true
    _error.value = if (listed == null) "Couldn't read teammates." else null
  }

  val phase: LoadPhase get() = LoadPhase.of(_loaded.value, _error.value, _teammates.value.isEmpty())

  fun teammate(id: String): Teammate? =
    _detailById.value[id]?.teammate ?: _teammates.value.firstOrNull { it.teammate.id == id }?.teammate

  suspend fun loadDetail(id: String): MethodsTypes.TeammatesGetResult? {
    val backend = host.backend ?: return null
    return try {
      backend.request(Methods.TeammatesGet, MethodsTypes.TeammatesGetParams(id)).also { result ->
        _detailById.update { it + (id to result) }
      }
    } catch (e: Exception) {
      fail("Couldn't read that teammate", e)
      null
    }
  }

  /** Patch identity, autonomy or the on switch. Null [patch] fields are left alone, except [clearAutonomy]. */
  suspend fun update(id: String, patch: UpdateTeammateInput, clearAutonomy: Boolean = false): Teammate? {
    val backend = host.backend ?: return null
    return try {
      val params = MethodsTypes.TeammatesUpdateParams(id, patch)
      val teammate = if (clearAutonomy) {
        backend.requestWithNulls(Methods.TeammatesUpdate, params, "patch.autonomy").teammate
      } else {
        backend.request(Methods.TeammatesUpdate, params).teammate
      }
      replace(teammate)
      _error.value = null
      teammate
    } catch (e: Exception) {
      fail("Couldn't save that teammate", e)
      null
    }
  }

  suspend fun setEnabled(id: String, enabled: Boolean) {
    update(id, UpdateTeammateInput(enabled = enabled))
  }

  suspend fun saveSoul(id: String, soul: String): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.TeammatesSaveSoul, MethodsTypes.TeammatesSaveSoulParams(id, soul))
      _detailById.update { map -> map[id]?.let { map + (id to it.copy(soul = soul)) } ?: map }
      true
    } catch (e: Exception) {
      fail("Couldn't save the soul", e)
      false
    }
  }

  /** [keepDuties] leaves its automations behind, paused and standalone; otherwise they go too. */
  suspend fun delete(id: String, keepDuties: Boolean): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.TeammatesDelete, MethodsTypes.TeammatesDeleteParams(id, keepDuties))
      _teammates.update { list -> list.filter { it.teammate.id != id } }
      _detailById.update { it - id }
      _threadsById.update { it - id }
      _memoriesById.update { it - id }
      true
    } catch (e: Exception) {
      fail("Couldn't delete that teammate", e)
      false
    }
  }

  /** Detach a duty: the automation stays, on its own. */
  suspend fun removeDuty(teammateId: String, automationId: String): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.TeammatesRemoveDuty, MethodsTypes.TeammatesRemoveDutyParams(automationId))
      _detailById.update { map ->
        map[teammateId]?.let { map + (teammateId to it.copy(duties = it.duties.filter { d -> d.id != automationId })) } ?: map
      }
      _teammates.update { list ->
        list.map { if (it.teammate.id == teammateId) it.copy(dutyCount = (it.dutyCount - 1).coerceAtLeast(0.0)) else it }
      }
      true
    } catch (e: Exception) {
      fail("Couldn't remove that duty", e)
      false
    }
  }

  private fun replace(teammate: Teammate) {
    _teammates.update { list -> list.map { if (it.teammate.id == teammate.id) it.copy(teammate = teammate) else it } }
    _detailById.update { map -> map[teammate.id]?.let { map + (teammate.id to it.copy(teammate = teammate)) } ?: map }
  }

  /** Show it, and report it: a failure the user sees is one worth knowing about. */
  internal fun fail(summary: String, error: Throwable) {
    if (HostStore.isQuiet(error)) return
    _error.value = "$summary — ${HostStore.describe(error)}"
    host.hooks.errorReported(error, "teammates")
  }
}
