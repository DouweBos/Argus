package dev.houwert.argus.core.stores

import dev.houwert.argus.core.blueprints.BlueprintForm
import dev.houwert.argus.core.blueprints.isRunning
import dev.houwert.argus.kit.protocol.generated.Blueprint
import dev.houwert.argus.kit.protocol.generated.BlueprintOverrides
import dev.houwert.argus.kit.protocol.generated.BlueprintRun
import dev.houwert.argus.kit.protocol.generated.BlueprintVisibility
import dev.houwert.argus.kit.protocol.generated.CreateProjectFromBlueprintInput
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.ReviseBlueprintInput
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive

/** The connected computer's blueprints and the projects made from them. Cleared when the computer changes. */
class BlueprintsStore(val host: HostStore) {
  private val _blueprints = MutableStateFlow(emptyList<Blueprint>())
  val blueprints: StateFlow<List<Blueprint>> = _blueprints.asStateFlow()
  /** Newest first, across every blueprint. */
  private val _runs = MutableStateFlow(emptyList<BlueprintRun>())
  val runs: StateFlow<List<BlueprintRun>> = _runs.asStateFlow()
  private val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()
  /** A generated draft waiting for the new-blueprint editor. */
  val pendingDraft = MutableStateFlow<BlueprintForm?>(null)
  private val _drafting = MutableStateFlow(false)
  val drafting: StateFlow<Boolean> = _drafting.asStateFlow()

  fun clear() {
    _blueprints.value = emptyList()
    _runs.value = emptyList()
    _loaded.value = false
    _error.value = null
    pendingDraft.value = null
    _drafting.value = false
  }

  fun clearError() { _error.value = null }

  val phase: LoadPhase get() = LoadPhase.of(_loaded.value, _error.value, _blueprints.value.isEmpty())

  fun blueprint(id: String): Blueprint? = _blueprints.value.firstOrNull { it.id == id }

  fun run(id: String): BlueprintRun? = _runs.value.firstOrNull { it.id == id }

  fun runs(blueprintId: String): List<BlueprintRun> = _runs.value.filter { it.blueprintId == blueprintId }

  suspend fun refresh() {
    val backend = host.backend ?: return
    val (listed, ran) = coroutineScope {
      val list = async { runCatching { backend.request(Methods.BlueprintsList, MethodsTypes.BlueprintsListParams()) }.getOrNull() }
      val history = async { runCatching { backend.request(Methods.BlueprintsRuns, MethodsTypes.BlueprintsRunsParams()) }.getOrNull() }
      list.await() to history.await()
    }
    if (listed == null && ran == null && !currentCoroutineContext().isActive) return
    listed?.let { _blueprints.value = it.blueprints.sortedWith(byName) }
    ran?.let { _runs.value = it.runs }
    _loaded.value = true
    _error.value = if (listed == null) "Couldn't read blueprints." else null
  }

  // Editing

  /** Create when [id] is null, otherwise save every field. Returns the id. */
  suspend fun save(id: String?, form: BlueprintForm): String? {
    val backend = host.backend ?: return null
    return try {
      val saved = if (id != null) {
        backend.request(Methods.BlueprintsUpdate, MethodsTypes.BlueprintsUpdateParams(id, form.updateInput)).blueprint
      } else {
        backend.request(Methods.BlueprintsCreate, MethodsTypes.BlueprintsCreateParams(form.createInput)).blueprint
      }
      upsert(saved)
      _error.value = null
      saved.id
    } catch (e: Exception) {
      fail("Couldn't save that blueprint", e)
      null
    }
  }

  suspend fun delete(id: String): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.BlueprintsDelete, MethodsTypes.BlueprintsDeleteParams(id))
      _blueprints.update { list -> list.filter { it.id != id } }
      true
    } catch (e: Exception) {
      fail("Couldn't delete that blueprint", e)
      false
    }
  }

  // Projects

  data class ProjectRequest(
    val name: String = "",
    val description: String = "",
    val parentDir: String? = null,
    val owner: String? = null,
    val visibility: BlueprintForm.Visibility? = null,
    val githubEnabled: Boolean? = null,
  ) {
    /** Letters, digits, dots, dashes and underscores, as the host checks. */
    val nameProblem: String?
      get() {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return "Name the project."
        val bad = trimmed.any { !(it.isLetterOrDigit() || it in "._-") } || trimmed.first() == '.' || trimmed.first() == '-'
        return if (bad) "Use letters, digits, dots, dashes or underscores." else null
      }
  }

  /** Starts it and returns the run as created; [watch] follows it. */
  suspend fun createProject(blueprintId: String, request: ProjectRequest): BlueprintRun? {
    val backend = host.backend ?: return null
    val overrides = BlueprintOverrides(
      parentDir = request.parentDir, owner = request.owner,
      visibility = request.visibility?.let { BlueprintVisibility(it.rawValue) }, githubEnabled = request.githubEnabled,
    )
    return try {
      val run = backend.request(
        Methods.BlueprintsCreateProject,
        MethodsTypes.BlueprintsCreateProjectParams(
          CreateProjectFromBlueprintInput(blueprintId, request.name.trim(), request.description, overrides),
        ),
      ).run
      upsert(run)
      _error.value = null
      run
    } catch (e: Exception) {
      fail("Couldn't start the project", e)
      null
    }
  }

  /** Re-reads the runs until this one settles: the phone gets no live events. */
  suspend fun watch(runId: String) {
    while (currentCoroutineContext().isActive && (run(runId)?.isRunning ?: true)) {
      delay(POLL_MS)
      val backend = host.backend ?: continue
      runCatching { backend.request(Methods.BlueprintsRuns, MethodsTypes.BlueprintsRunsParams()) }
        .onSuccess { _runs.value = it.runs }
    }
  }

  // Drafting

  /** Claude reads the projects and drafts a blueprint into [pendingDraft]. */
  suspend fun draft(paths: List<String>): Boolean {
    val backend = host.backend ?: return false
    if (paths.isEmpty()) return false
    _drafting.value = true
    return try {
      val draft = backend.request(Methods.BlueprintsDraft, MethodsTypes.BlueprintsDraftParams(paths)).draft
      pendingDraft.value = BlueprintForm.from(draft)
      _error.value = null
      true
    } catch (e: Exception) {
      fail("Couldn't draft a blueprint", e)
      false
    } finally {
      _drafting.value = false
    }
  }

  /** Claude rewrites the form's instructions to [note]; nothing is saved. Null when it failed. */
  suspend fun revise(form: BlueprintForm, note: String): String? {
    val backend = host.backend ?: return null
    val input = ReviseBlueprintInput(form.instructions, note, form.name.ifEmpty { null }, form.references.map { it.path })
    return try {
      val result = backend.request(Methods.BlueprintsRevise, MethodsTypes.BlueprintsReviseParams(input))
      _error.value = null
      result.instructions
    } catch (e: Exception) {
      fail("Couldn't revise the instructions", e)
      null
    }
  }

  private fun upsert(blueprint: Blueprint) {
    _blueprints.update { list ->
      if (list.any { it.id == blueprint.id }) list.map { if (it.id == blueprint.id) blueprint else it }
      else (list + blueprint).sortedWith(byName)
    }
  }

  private fun upsert(run: BlueprintRun) {
    _runs.update { list -> listOf(run) + list.filter { it.id != run.id } }
  }

  private fun fail(summary: String, error: Throwable) {
    if (HostStore.isQuiet(error)) return
    _error.value = "$summary — ${HostStore.describe(error)}"
    host.hooks.errorReported(error, "blueprints")
  }

  private companion object {
    const val POLL_MS = 1_000L
    val byName = compareBy<Blueprint, String>(String.CASE_INSENSITIVE_ORDER) { it.name }
  }
}
