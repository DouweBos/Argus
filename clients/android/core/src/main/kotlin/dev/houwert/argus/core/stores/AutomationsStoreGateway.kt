package dev.houwert.argus.core.stores

import dev.houwert.argus.core.automations.Autonomy
import dev.houwert.argus.core.backend.requestWithNulls
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAutomationDetail
import java.util.TimeZone
import kotlinx.coroutines.flow.update

// The automation actions a phone reaches through typed gateway methods.

/** A run's record, report and the proposals it raised, gone for good. */
suspend fun AutomationsStore.deleteRunOverGateway(id: String): Boolean {
  val backend = host.backend ?: return false
  return try {
    backend.request(Methods.AutomationsDeleteRun, MethodsTypes.AutomationsDeleteRunParams(id))
    host.hooks.track(StoreEvent.RunActed(StoreEvent.RunAction.Delete))
    _runs.update { list -> list.filter { it.id != id } }
    _quickRuns.update { list -> list?.filter { it.id != id } }
    _detailByRun.update { it - id }
    true
  } catch (e: Exception) {
    fail("Couldn't delete that run", e)
    false
  }
}

/** The Quick Run screen's history; a computer too old to list them leaves them among the recent runs. */
suspend fun AutomationsStore.loadQuickRunsOverGateway() {
  val backend = host.backend ?: return
  try {
    _quickRuns.value = backend.request(Methods.AutomationsScratchRuns, MethodsTypes.AutomationsScratchRunsParams(limit = 40)).runs
  } catch (e: Exception) {
    if (HostStore.isQuiet(e)) return
    if (_runs.value.isEmpty()) refresh()
    _quickRuns.value = _runs.value.filter { it.isQuick }
  }
}

/** How often its proposals were kept versus dismissed. */
suspend fun AutomationsStore.loadCalibrationOverGateway(automationId: String) {
  val backend = host.backend ?: return
  runCatching { backend.request(Methods.AutomationsCalibration, MethodsTypes.AutomationsCalibrationParams(automationId)) }
    .onSuccess { calibration -> _calibrationById.update { it + (automationId to calibration) } }
}

/** A drafted automation and the computer's notes on it. */
data class AutomationDraft(val automation: RemoteAutomationDetail, val notes: List<String>)

/** "Describe it": the computer drafts one from a sentence, for review. Nothing is saved. */
suspend fun AutomationsStore.draftOverGateway(description: String, regenerating: Boolean = false): AutomationDraft? {
  val backend = host.backend ?: return null
  return try {
    val result = backend.request(Methods.AutomationsDraft, MethodsTypes.AutomationsDraftParams(description, TimeZone.getDefault().id))
    host.hooks.track(
      StoreEvent.AutomationEdited(if (regenerating) StoreEvent.AutomationAction.Regenerate else StoreEvent.AutomationAction.Describe),
    )
    clearError()
    AutomationDraft(result.automation, result.notes)
  } catch (e: Exception) {
    fail("Couldn't draft that automation", e)
    null
  }
}

/** The computer's cap on autonomy: outer null when it couldn't say, inner null for no cap. */
suspend fun AutomationsStore.loadDefaultAutonomy(): Result<Autonomy?>? {
  val backend = host.backend ?: return null
  val result = runCatching { backend.request(Methods.AutomationsDefaultAutonomy, MethodsTypes.AutomationsDefaultAutonomyParams()) }
    .getOrNull() ?: return null
  return Result.success(Autonomy.fromRaw(result.autonomy?.rawValue))
}

suspend fun AutomationsStore.setDefaultAutonomy(autonomy: Autonomy?): Boolean {
  val backend = host.backend ?: return false
  return try {
    // Null clears the cap, so it has to be sent rather than omitted.
    backend.requestWithNulls(
      Methods.AutomationsSetDefaultAutonomy,
      MethodsTypes.AutomationsSetDefaultAutonomyParams(autonomy?.let { MethodsTypes.AutomationsSetDefaultAutonomyParamsAutonomy(it.rawValue) }),
      "autonomy",
    )
    true
  } catch (e: Exception) {
    fail("Couldn't change the default autonomy", e)
    false
  }
}
