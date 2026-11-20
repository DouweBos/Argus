package dev.houwert.argus.core.settings

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupEntry
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPolicy
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupPreview
import dev.houwert.argus.kit.protocol.generated.WorktreeCleanupSweep
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The worktree cleanup policy and its dry run, for Settings → Worktrees. Call from the store's dispatcher. */
class WorktreeCleanupModel(private val backend: () -> HostBackend?) {
  constructor(host: HostStore) : this({ host.backend })

  private val _preview = MutableStateFlow<WorktreeCleanupPreview?>(null)
  val preview: StateFlow<WorktreeCleanupPreview?> = _preview.asStateFlow()
  private val _cleaning = MutableStateFlow(false)
  val cleaning: StateFlow<Boolean> = _cleaning.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()

  suspend fun load() {
    val backend = backend() ?: return
    try {
      _preview.value = backend.request(Methods.WorktreesCleanupPreview, MethodsTypes.WorktreesCleanupPreviewParams())
      _error.value = null
    } catch (e: Exception) {
      _error.value = HostStore.describe(e)
    }
  }

  /** Saves the policy, then re-runs the dry run against it. */
  suspend fun setPolicy(next: WorktreeCleanupPolicy): Boolean {
    val backend = backend() ?: return false
    val previous = _preview.value
    _preview.value = previous?.copy(policy = next)
    return try {
      backend.request(Methods.WorktreesSetCleanupPolicy, next)
      load()
      true
    } catch (e: Exception) {
      _preview.value = previous
      _error.value = HostStore.describe(e)
      false
    }
  }

  suspend fun cleanUpNow(): WorktreeCleanupSweep? {
    val backend = backend() ?: return null
    if (_cleaning.value) return null
    _cleaning.value = true
    return try {
      backend.request(Methods.WorktreesCleanupRun, MethodsTypes.WorktreesCleanupRunParams()).also { load() }
    } catch (e: Exception) {
      _error.value = HostStore.describe(e)
      null
    } finally {
      _cleaning.value = false
    }
  }

  /** Gallery and previews render the cleanup without a host. */
  fun fill(preview: WorktreeCleanupPreview) { _preview.value = preview }

  companion object {
    fun removable(preview: WorktreeCleanupPreview?): List<WorktreeCleanupEntry> = preview?.entries?.filter { it.blockedBy == null } ?: emptyList()
    fun kept(preview: WorktreeCleanupPreview?): List<WorktreeCleanupEntry> = preview?.entries?.filter { it.blockedBy != null } ?: emptyList()
    fun reclaimableBytes(preview: WorktreeCleanupPreview?): Double = removable(preview).sumOf { it.bytes ?: 0.0 }

    /** Keeps a value set elsewhere selectable instead of blanking the picker. */
    fun <T : Comparable<T>> withCurrent(options: List<T>, current: T, zero: T): List<T> =
      if (current == zero || current in options) options else (options + current).sorted()
  }
}
