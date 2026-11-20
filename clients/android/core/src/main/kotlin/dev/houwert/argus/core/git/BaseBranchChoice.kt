package dev.houwert.argus.core.git

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Which branch a new worktree starts from, as the desktop picks it. */
object BaseBranchChoice {
  val common = listOf("staging", "develop", "dev", "main", "master")

  /**
   * `.argus.json`'s `default_base_branch`, then its protected branches, then the usual names;
   * `origin/<name>` over a local copy the project root has checked out, since that one may
   * have drifted. Else the first local branch.
   */
  fun preselected(local: List<String>, originRefs: List<String>, configured: String?, protected: List<String>, projectRootBranch: String?): String? {
    val origins = originRefs.toSet()
    val seen = mutableSetOf<String>()
    for (name in listOfNotNull(configured) + protected + common) {
      if (!seen.add(name)) continue
      val origin = "origin/$name"
      val hasOrigin = origin in origins
      if (hasOrigin && projectRootBranch == name) return origin
      if (name in local) return name
      if (hasOrigin) return origin
    }
    return local.firstOrNull()
  }

  /** The local branches, plus the `origin/` refs of base-like ones only. */
  fun options(local: List<String>, originRefs: List<String>, protected: List<String>): List<String> {
    val hints = (protected + common).toSet()
    return local + originRefs.filter { it.startsWith("origin/") && it.removePrefix("origin/") in hints }
  }
}

/** A new worktree's base: the branches it may start from and the one [BaseBranchChoice] preselects, read once. */
class BaseBranchPicker {
  private val _picked = MutableStateFlow<String?>(null)
  /** The base the user picked; null keeps the preselected one. */
  val picked: StateFlow<String?> = _picked.asStateFlow()
  private val _options = MutableStateFlow(emptyList<String>())
  val options: StateFlow<List<String>> = _options.asStateFlow()
  private val _preselected = MutableStateFlow<String?>(null)
  val preselected: StateFlow<String?> = _preselected.asStateFlow()
  private val _loading = MutableStateFlow(false)
  val loading: StateFlow<Boolean> = _loading.asStateFlow()
  private var loaded = false

  val base: String? get() = _picked.value ?: _preselected.value

  fun pick(branch: String?) { _picked.value = branch }

  /** Read once, when a worktree is first asked for; the current checkout never needs them. */
  suspend fun load(repoRoot: String, projectRootBranch: String?, store: HostStore) {
    if (loaded) return
    val backend = store.backend ?: return
    loaded = true
    _loading.value = true
    val source = runCatching { backend.request(Methods.ProjectsBaseBranches, MethodsTypes.ProjectsBaseBranchesParams(repoRoot)) }.getOrNull()
    _loading.value = false
    source ?: return
    _options.value = BaseBranchChoice.options(source.local, source.originRefs, source.protectedBranches)
    _preselected.value = BaseBranchChoice.preselected(
      source.local, source.originRefs, source.defaultBaseBranch?.ifEmpty { null }, source.protectedBranches, projectRootBranch,
    )
  }
}
