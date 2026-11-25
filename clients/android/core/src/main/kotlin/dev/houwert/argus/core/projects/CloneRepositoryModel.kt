package dev.houwert.argus.core.projects

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.CloneDefaults
import dev.houwert.argus.kit.protocol.generated.CloneJob
import dev.houwert.argus.kit.protocol.generated.ClonePhase
import dev.houwert.argus.kit.protocol.generated.ClonePreview
import dev.houwert.argus.kit.protocol.generated.ClonePreviewInput
import dev.houwert.argus.kit.protocol.generated.CloneSource
import dev.houwert.argus.kit.protocol.generated.CloneStatus
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.StartCloneInput
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive

/**
 * Clone Repository: an address, a folder on the computer and a name, checked by the host as
 * they're typed, then the clone's live progress from `projects.clone` events.
 */
class CloneRepositoryModel(private val host: HostStore, cloneId: String? = null) {
  val url = MutableStateFlow("")
  val parentDir = MutableStateFlow("")
  /** Empty uses the repository's own name. */
  val name = MutableStateFlow("")
  private val _defaults = MutableStateFlow<CloneDefaults?>(null)
  val defaults: StateFlow<CloneDefaults?> = _defaults.asStateFlow()
  private val _preview = MutableStateFlow<ClonePreview?>(null)
  val preview: StateFlow<ClonePreview?> = _preview.asStateFlow()
  private val _cloneId = MutableStateFlow(cloneId)
  val cloneId: StateFlow<String?> = _cloneId.asStateFlow()
  private val _starting = MutableStateFlow(false)
  val starting: StateFlow<Boolean> = _starting.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()

  /** The clone this screen follows, as the latest event left it. */
  fun job(clones: Map<String, CloneJob> = host.clones.value): CloneJob? = _cloneId.value?.let { clones[it] }

  val isRunning: Boolean get() = job()?.status == CloneStatus.running

  /** Folders worth offering, the current one first. */
  fun parentChoices(): List<String> =
    (listOf(parentDir.value) + (_defaults.value?.parents ?: emptyList())).filter { it.isNotEmpty() }.distinct()

  val canStart: Boolean
    get() = !_starting.value && !isRunning && url.value.isNotBlank() && _preview.value?.let { it.problem == null } == true

  /** Defaults, plus any clone already running (a reconnect, a second screen). */
  suspend fun load() {
    val backend = host.backend ?: return
    if (_defaults.value == null) {
      runCatching { backend.request(Methods.ProjectsCloneDefaults, MethodsTypes.ProjectsCloneDefaultsParams()) }.getOrNull()?.let {
        _defaults.value = it
        if (parentDir.value.isEmpty()) parentDir.value = it.parentDir
      }
    }
    refreshClones()
    // Reopened while a clone runs: follow it rather than offer a second one.
    if (_cloneId.value == null) {
      _cloneId.value = host.clones.value.values.filter { it.status == CloneStatus.running }.maxByOrNull { it.startedAt }?.id
    }
  }

  suspend fun refreshClones() {
    val backend = host.backend ?: return
    val listed = runCatching { backend.request(Methods.ProjectsClones, MethodsTypes.ProjectsClonesParams()) }.getOrNull() ?: return
    host._clones.update { current -> current + listed.clones.associateBy { it.id } }
  }

  /** Asks the host what these fields would clone into, or why they can't. */
  suspend fun refreshPreview() {
    val backend = host.backend ?: return
    val trimmed = url.value.trim()
    if (trimmed.isEmpty()) {
      _preview.value = null
      return
    }
    val input = ClonePreviewInput(trimmed, parentDir.value, name.value.trim().ifEmpty { null })
    runCatching { backend.request(Methods.ProjectsClonePreview, MethodsTypes.ProjectsClonePreviewParams(input)) }
      .getOrNull()?.let { _preview.value = it }
  }

  suspend fun start(source: CloneSource): Boolean {
    val backend = host.backend ?: return false
    if (!canStart) return false
    _starting.value = true
    return try {
      val input = StartCloneInput(url.value.trim(), parentDir.value, name.value.trim().ifEmpty { null }, source)
      val job = backend.request(Methods.ProjectsClone, MethodsTypes.ProjectsCloneParams(input)).clone
      // An event can land before the reply; keep whichever came first.
      host._clones.update { if (job.id in it) it else it + (job.id to job) }
      _cloneId.value = job.id
      _error.value = null
      true
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e)) {
        _error.value = HostStore.describe(e)
        host.hooks.errorReported(e, "clone")
      }
      false
    } finally {
      _starting.value = false
    }
  }

  suspend fun cancel() {
    val backend = host.backend ?: return
    val id = _cloneId.value ?: return
    if (!isRunning) return
    runCatching { backend.request(Methods.ProjectsCloneCancel, MethodsTypes.ProjectsCloneCancelParams(id)) }
  }

  /** Back to the form after a failure, keeping what was typed. */
  fun retry() {
    _cloneId.value = null
  }

  /** Polls while running; covers a connection that missed an event. */
  suspend fun watch() {
    while (currentCoroutineContext().isActive && isRunning) {
      delay(POLL_MS)
      refreshClones()
    }
  }

  companion object {
    private const val POLL_MS = 2_000L

    fun phaseLabel(phase: ClonePhase): String = when (phase) {
      ClonePhase.connecting -> "Connecting"
      ClonePhase.counting -> "Counting objects"
      ClonePhase.compressing -> "Compressing objects"
      ClonePhase.receiving -> "Receiving objects"
      ClonePhase.resolving -> "Resolving deltas"
      ClonePhase.checkingOut -> "Checking out files"
      else -> phase.rawValue.replaceFirstChar { it.uppercase() }
    }

    /** Phase and percent in one line, e.g. "Receiving objects 42%". */
    fun progressLabel(job: CloneJob): String {
      val phase = phaseLabel(job.phase)
      return job.percent?.let { "$phase ${it.toInt()}%" } ?: phase
    }

    private val weights = listOf(
      ClonePhase.connecting to 0.0, ClonePhase.counting to 0.05, ClonePhase.compressing to 0.05,
      ClonePhase.receiving to 0.7, ClonePhase.resolving to 0.15, ClonePhase.checkingOut to 0.05,
    )

    /** Overall progress across the phases, 0-1, for one bar instead of five. */
    fun overallFraction(job: CloneJob): Float? {
      val index = weights.indexOfFirst { it.first == job.phase }
      if (index < 0) return null
      val done = weights.take(index).sumOf { it.second }
      val within = (job.percent ?: 0.0) / 100 * weights[index].second
      return minOf(1.0, done + within).toFloat()
    }
  }
}
