package dev.houwert.argus.core.skills

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.Skill
import dev.houwert.argus.kit.protocol.generated.SkillInstallFrom
import dev.houwert.argus.kit.protocol.generated.SkillInstallInput
import dev.houwert.argus.kit.protocol.generated.SkillInstallResultStatus
import dev.houwert.argus.kit.protocol.generated.SkillRunner
import dev.houwert.argus.kit.protocol.generated.SkillScope
import dev.houwert.argus.kit.protocol.generated.SkillTarget
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Install Skill from a git URL or a gist. A folder or a `.skill` file is a path on the computer, so
 * those install from the Mac. Stops to ask before replacing a skill of the same name.
 */
class SkillInstallModel(val skills: SkillsModel, url: String? = null) {
  val location = MutableStateFlow(url ?: "")
  val subpath = MutableStateFlow("")
  val scope = MutableStateFlow(SkillScope.user)
  val runner = MutableStateFlow(SkillRunner.claudeCode)
  val repoRoot = MutableStateFlow<String?>(null)
  private val _installing = MutableStateFlow(false)
  val installing: StateFlow<Boolean> = _installing.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()
  /** Set when a skill of this name is already there; Replace installs over it. */
  private val _conflict = MutableStateFlow<String?>(null)
  val conflict: StateFlow<String?> = _conflict.asStateFlow()

  val canInstall: Boolean
    get() = !_installing.value && location.value.isNotBlank() && (scope.value == SkillScope.user || repoRoot.value != null)

  /** Any edit names a different install, so the replace question no longer applies. */
  fun edited() {
    _conflict.value = null
  }

  fun destinationHint(projectName: String?): String {
    val codex = runner.value == SkillRunner.codex
    if (scope.value == SkillScope.user) {
      return if (codex) "Installs into ~/.codex/skills, for every project." else "Installs into ~/.claude/skills, for every project."
    }
    val folder = if (codex) ".codex/skills" else ".claude/skills"
    return "Installs into $folder in ${projectName ?: "the project"}, so it's checked in with the project."
  }

  suspend fun install(): Skill? {
    val backend = skills.host.backend ?: return null
    if (!canInstall) return null
    _installing.value = true
    return try {
      val input = SkillInstallInput(
        SkillInstallFrom.url, location.value.trim(), subpath.value.trim().ifEmpty { null },
        SkillTarget(scope.value, runner.value, if (scope.value == SkillScope.project) repoRoot.value else null),
        overwrite = _conflict.value != null,
      )
      val result = backend.request(Methods.SkillsInstall, MethodsTypes.SkillsInstallParams(input))
      if (result.status == SkillInstallResultStatus.exists) {
        _conflict.value = result.name
        return null
      }
      _conflict.value = null
      _error.value = null
      result.skill?.also { skills.installed(it) }
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e)) {
        _error.value = HostStore.describe(e)
        skills.host.hooks.errorReported(e, "skills")
      }
      null
    } finally {
      _installing.value = false
    }
  }

  companion object {
    const val URL_HINT = "A git repository, a GitHub link to the folder holding SKILL.md, or a gist."
  }
}
