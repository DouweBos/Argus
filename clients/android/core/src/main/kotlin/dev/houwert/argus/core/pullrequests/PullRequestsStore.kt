package dev.houwert.argus.core.pullrequests

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemotePullRequest
import dev.houwert.argus.kit.protocol.generated.RemotePullRequestDetail
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The pull requests the connected computer's `gh` says are yours to look at, and the one
 * you have open. Cleared whenever the active computer changes.
 */
class PullRequestsStore(private val host: HostStore) {
  private val _pullRequests = MutableStateFlow(emptyList<RemotePullRequest>())
  val pullRequests: StateFlow<List<RemotePullRequest>> = _pullRequests.asStateFlow()
  private val _detailById = MutableStateFlow(emptyMap<String, RemotePullRequestDetail>())
  val detailById: StateFlow<Map<String, RemotePullRequestDetail>> = _detailById.asStateFlow()
  private val _loaded = MutableStateFlow(false)
  val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()

  fun clear() {
    _pullRequests.value = emptyList()
    _detailById.value = emptyMap()
    _loaded.value = false
    _error.value = null
  }

  suspend fun refresh() {
    val backend = host.backend ?: return
    try {
      _pullRequests.value = backend.request(Methods.GithubPullRequests, MethodsTypes.GithubPullRequestsParams()).pullRequests
      _error.value = null
    } catch (e: Exception) {
      // A screen left mid-load answered nothing; settling would read as "none".
      if (HostStore.isQuiet(e)) return
      // `gh` missing or signed out is the usual cause, worth saying rather than showing an empty list.
      fail("Couldn't read pull requests", e)
    }
    _loaded.value = true
  }

  suspend fun loadDetail(repo: String, number: Int): RemotePullRequestDetail? {
    val backend = host.backend ?: return null
    return try {
      val detail = backend.request(Methods.GithubPullRequest, MethodsTypes.GithubPullRequestParams(repo, number.toLong())).pullRequest
      _detailById.update { it + (detail.id to detail) }
      detail
    } catch (e: Exception) {
      fail("Couldn't read that pull request", e)
      null
    }
  }

  /** The unified diff; throws for the screen to show rather than the list's banner. */
  suspend fun diff(repo: String, number: Int): String {
    val backend = host.backend ?: return ""
    return backend.request(Methods.GithubPullRequestDiff, MethodsTypes.GithubPullRequestDiffParams(repo, number.toLong())).diff
  }

  /** Open a PR for a session's branch; the computer works out base and head from the session. Its URL. */
  suspend fun create(sessionId: String, title: String, body: String, draft: Boolean): String? {
    val backend = host.backend ?: return null
    return try {
      val result = backend.request(Methods.GithubCreatePullRequest, MethodsTypes.GithubCreatePullRequestParams(sessionId, title, body, draft))
      host.hooks.track(StoreEvent.PullRequestActed(StoreEvent.PullRequestAction.Open))
      refresh()
      result.url
    } catch (e: Exception) {
      fail("Couldn't open that pull request", e)
      null
    }
  }

  /** The repo's PR template for a session, null when it has none (or the computer predates templates). */
  suspend fun template(sessionId: String): String? {
    val backend = host.backend ?: return null
    return runCatching { backend.request(Methods.GithubPullRequestTemplate, MethodsTypes.GithubPullRequestTemplateParams(sessionId)).template }.getOrNull()
  }

  /** Claude's title and description; null when it couldn't draft one. Throws for the sheet to show. */
  suspend fun fill(sessionId: String, title: String): MethodsTypes.GithubFillPullRequestResult? {
    val backend = host.backend ?: return null
    try {
      val draft = backend.request(Methods.GithubFillPullRequest, MethodsTypes.GithubFillPullRequestParams(sessionId, title))
      host.hooks.track(StoreEvent.PullRequestActed(StoreEvent.PullRequestAction.Fill))
      return if (draft.body == null) null else draft
    } catch (e: Exception) {
      if (!HostStore.isQuiet(e)) host.hooks.errorReported(e, "pull_requests")
      throw e
    }
  }

  suspend fun merge(repo: String, number: Int, strategy: RemoteMergeStrategy): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(
        Methods.GithubMergePullRequest,
        MethodsTypes.GithubMergePullRequestParams(repo, number.toLong(), MethodsTypes.GithubMergePullRequestParamsStrategy(strategy.wire)),
      )
      host.hooks.track(StoreEvent.PullRequestActed(StoreEvent.PullRequestAction.Merge))
      loadDetail(repo, number)
      refresh()
      true
    } catch (e: Exception) {
      fail("Couldn't merge that pull request", e)
      false
    }
  }

  suspend fun comment(repo: String, number: Int, body: String): Boolean {
    val backend = host.backend ?: return false
    return try {
      backend.request(Methods.GithubCommentPullRequest, MethodsTypes.GithubCommentPullRequestParams(repo, number.toLong(), body))
      host.hooks.track(StoreEvent.PullRequestActed(StoreEvent.PullRequestAction.Comment))
      loadDetail(repo, number)
      true
    } catch (e: Exception) {
      fail("Couldn't post that comment", e)
      false
    }
  }

  /** Show it, and send it: a failure the user sees is one worth knowing about. */
  private fun fail(summary: String, error: Throwable) {
    if (HostStore.isQuiet(error)) return
    _error.value = "$summary — ${HostStore.describe(error)}"
    host.hooks.errorReported(error, "pull_requests")
  }
}
