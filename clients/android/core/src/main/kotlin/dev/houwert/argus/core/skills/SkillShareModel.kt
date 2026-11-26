package dev.houwert.argus.core.skills

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.Skill
import dev.houwert.argus.kit.protocol.generated.SkillShareInput
import dev.houwert.argus.kit.protocol.generated.SkillShareTarget
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Share a skill as a gist or a new GitHub repository through the computer's `gh`; the link it
 * returns is one Install Skill takes. A `.skill` file is the Mac's.
 */
class SkillShareModel(val skill: Skill, private val host: HostStore) {
  val target = MutableStateFlow(SkillShareTarget.gist)
  val public = MutableStateFlow(false)
  /** Empty uses the skill's folder name. */
  val repoName = MutableStateFlow("")
  private val _sharing = MutableStateFlow(false)
  val sharing: StateFlow<Boolean> = _sharing.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()
  private val _url = MutableStateFlow<String?>(null)
  val url: StateFlow<String?> = _url.asStateFlow()

  val folderName: String get() = skill.path.trimEnd('/').substringAfterLast('/')

  fun visibilityLabels(target: SkillShareTarget): Pair<String, String> =
    if (target == SkillShareTarget.gist) "Secret" to "Public" else "Private" to "Public"

  fun hint(target: SkillShareTarget): String =
    if (target == SkillShareTarget.gist) {
      "A gist holds the skill's files but no folders. Anyone with a secret gist's link can install it."
    } else {
      "Creates the repository on your GitHub account with gh and pushes the skill's files to it."
    }

  suspend fun share(): Boolean {
    val backend = host.backend ?: return false
    if (_sharing.value) return false
    _sharing.value = true
    return try {
      val name = repoName.value.trim()
      val input = SkillShareInput(
        skill.path, target.value, public.value,
        if (target.value == SkillShareTarget.repo && name.isNotEmpty()) name else null,
      )
      _url.value = backend.request(Methods.SkillsShare, MethodsTypes.SkillsShareParams(input)).url
      _error.value = null
      true
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e)) {
        _error.value = HostStore.describe(e)
        host.hooks.errorReported(e, "skills")
      }
      false
    } finally {
      _sharing.value = false
    }
  }
}
