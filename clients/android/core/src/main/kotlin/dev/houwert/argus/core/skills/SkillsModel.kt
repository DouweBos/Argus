package dev.houwert.argus.core.skills

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.Skill
import dev.houwert.argus.kit.protocol.generated.SkillRunner
import dev.houwert.argus.kit.protocol.generated.SkillScope
import dev.houwert.argus.kit.protocol.generated.SkillSource
import dev.houwert.argus.kit.protocol.generated.SkillSourceKind
import java.net.URI
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** The Skills screen: every skill folder the runners read on the computer, and updating or removing them. */
class SkillsModel(val host: HostStore) {
  private val _skills = MutableStateFlow<List<Skill>>(emptyList())
  val skills: StateFlow<List<Skill>> = _skills.asStateFlow()
  private val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()
  /** A short confirmation of the last action. */
  private val _notice = MutableStateFlow<String?>(null)
  val notice: StateFlow<String?> = _notice.asStateFlow()
  private val _busy = MutableStateFlow<Set<String>>(emptySet())
  val busy: StateFlow<Set<String>> = _busy.asStateFlow()

  suspend fun refresh() {
    val backend = host.backend ?: return
    try {
      _skills.value = backend.request(Methods.SkillsList, MethodsTypes.SkillsListParams()).skills
      _error.value = null
    } catch (e: Exception) {
      if (HostStore.isQuiet(e)) return
      _error.value = "Couldn't read skills: ${HostStore.describe(e)}"
    } finally {
      _loaded.value = true
    }
  }

  data class Section(val id: String, val title: String, val skills: List<Skill>)

  fun sections(list: List<Skill> = _skills.value): List<Section> {
    val byName = compareBy<Skill, String>(String.CASE_INSENSITIVE_ORDER) { it.name }
    val out = mutableListOf<Section>()
    val user = list.filter { it.scope == SkillScope.user }
    if (user.isNotEmpty()) out += Section("user", "Your Skills", user.sortedWith(byName))
    list.filter { it.scope == SkillScope.project }.groupBy { it.repoRoot ?: "" }
      .map { (root, skills) -> Section(root, projectTitle(skills.first()), skills.sortedWith(byName)) }
      .sortedBy { it.title }
      .forEach { out += it }
    return out
  }

  suspend fun update(skill: Skill) = act(skill) { backend ->
    val result = backend.request(Methods.SkillsUpdate, MethodsTypes.SkillsUpdateParams(skill.path))
    replace(result.skill)
    _notice.value = if (result.changed) "Updated ${result.skill.name}." else "${result.skill.name} is up to date."
  }

  suspend fun remove(skill: Skill) = act(skill) { backend ->
    backend.request(Methods.SkillsRemove, MethodsTypes.SkillsRemoveParams(skill.path))
    _skills.update { list -> list.filter { it.path != skill.path } }
    _notice.value = "Removed ${skill.name}."
  }

  private suspend fun act(skill: Skill, run: suspend (HostBackend) -> Unit): Boolean {
    val backend = host.backend ?: return false
    if (skill.path in _busy.value) return false
    _busy.update { it + skill.path }
    return try {
      run(backend)
      _error.value = null
      true
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e)) {
        _error.value = HostStore.describe(e)
        host.hooks.errorReported(e, "skills")
      }
      false
    } finally {
      _busy.update { it - skill.path }
    }
  }

  internal fun replace(skill: Skill) {
    _skills.update { list -> if (list.any { it.path == skill.path }) list.map { if (it.path == skill.path) skill else it } else list + skill }
  }

  internal fun installed(skill: Skill) {
    replace(skill)
    _notice.value = "Installed ${skill.name}."
    _error.value = null
  }

  fun dismissNotice() {
    _notice.value = null
  }

  companion object {
    fun runnerLabel(runner: SkillRunner): String = if (runner == SkillRunner.codex) "Codex" else "Claude Code"

    fun projectTitle(skill: Skill): String =
      skill.projectName ?: skill.repoRoot?.trimEnd('/')?.substringAfterLast('/') ?: "Project"

    /** Where it was installed from, short enough for a row: `octo/skills`, `Gist`, a folder's name. */
    fun sourceLabel(source: SkillSource?): String? {
      source ?: return null
      return when (source.kind) {
        SkillSourceKind.gist -> "Gist"
        SkillSourceKind.git -> {
          val trimmed = source.location.removeSuffix(".git")
          val uri = runCatching { URI(trimmed) }.getOrNull()
          if (uri?.host != null) {
            val path = uri.path.split('/').filter { it.isNotEmpty() }.take(2).joinToString("/")
            if (uri.host == "github.com") path else "${uri.host}/$path"
          } else {
            trimmed.replace(Regex("^[^@]+@[^:]+:"), "")
          }
        }
        else -> source.location.trimEnd('/').substringAfterLast('/')
      }
    }

    fun detail(skill: Skill): String =
      skill.description ?: "${skill.fileCount} file${if (skill.fileCount == 1L) "" else "s"}"

    fun canUpdate(skill: Skill): Boolean = skill.source != null
  }
}
