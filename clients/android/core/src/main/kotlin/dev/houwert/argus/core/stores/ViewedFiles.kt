package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteViewedFile
import dev.houwert.argus.kit.protocol.generated.RemoteViewedFileState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Which files of one diff are ticked as viewed. A pull request's marks are GitHub's own,
 * so github.com shows the same progress; a session's are kept on the computer. A mark reads
 * `changed` once the file changed after it.
 */
class ViewedFiles(val scope: Scope, private val host: HostStore) {
  sealed interface Scope {
    data class PullRequest(val repo: String, val number: Int) : Scope
    /** [mode] is `branch` (vs base) or `working` (uncommitted). */
    data class Session(val id: String, val mode: String) : Scope
  }

  private val _states = MutableStateFlow(emptyMap<String, RemoteViewedFileState>())
  val states: StateFlow<Map<String, RemoteViewedFileState>> = _states.asStateFlow()
  /** The last tick that didn't stick. */
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()

  fun state(path: String): RemoteViewedFileState? = _states.value[path]

  fun isViewed(path: String) = _states.value[path] == RemoteViewedFileState.viewed

  /** How many of [paths] are viewed and still as they were. */
  fun viewedCount(paths: List<String>) = paths.count(::isViewed)

  suspend fun load() {
    val backend = host.backend ?: return
    try {
      val files = when (scope) {
        is Scope.PullRequest ->
          backend.request(Methods.GithubPullRequestViewedFiles, MethodsTypes.GithubPullRequestViewedFilesParams(scope.repo, scope.number.toLong())).files
        is Scope.Session ->
          backend.request(Methods.SessionsViewedFiles, MethodsTypes.SessionsViewedFilesParams(scope.id, MethodsTypes.SessionsViewedFilesParamsMode(scope.mode))).files
      }
      apply(files)
    } catch (e: Exception) {
      // Marks are an aid: a computer without them, or `gh` signed out, shows none.
      if (HostStore.isCancellation(e)) throw e
    }
  }

  suspend fun toggle(path: String) = set(path, !isViewed(path))

  suspend fun set(path: String, viewed: Boolean) {
    val backend = host.backend ?: return
    val before = _states.value[path]
    _states.update { if (viewed) it + (path to RemoteViewedFileState.viewed) else it - path }
    try {
      val files = when (scope) {
        is Scope.PullRequest -> backend.request(
          Methods.GithubSetPullRequestFileViewed,
          MethodsTypes.GithubSetPullRequestFileViewedParams(scope.repo, scope.number.toLong(), path, viewed),
        ).files
        is Scope.Session -> backend.request(
          Methods.SessionsSetFileViewed,
          MethodsTypes.SessionsSetFileViewedParams(scope.id, MethodsTypes.SessionsSetFileViewedParamsMode(scope.mode), path, viewed),
        ).files
      }
      apply(files)
      _error.value = null
    } catch (e: Exception) {
      _states.update { if (before == null) it - path else it + (path to before) }
      if (HostStore.isQuiet(e)) return
      _error.value = "Couldn't mark that file — ${HostStore.describe(e)}"
      host.hooks.errorReported(e, "viewed_files")
    }
  }

  private fun apply(files: List<RemoteViewedFile>) {
    _states.value = files.associate { it.path to it.state }
  }
}
