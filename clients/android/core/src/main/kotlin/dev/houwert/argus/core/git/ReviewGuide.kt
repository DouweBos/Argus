package dev.houwert.argus.core.git

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemotePullRequestReviewComment
import dev.houwert.argus.kit.protocol.generated.RemotePullRequestReviewCommentSide
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideRange
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideRangeSide
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideState
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideStop
import dev.houwert.argus.kit.util.DiffFile
import dev.houwert.argus.kit.util.DiffHunk
import dev.houwert.argus.kit.util.DiffParser
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable

/** What a review guide tours: a session's branch and uncommitted work, or a pull request. */
@Serializable
sealed interface ReviewGuideTarget {
  @Serializable data class Session(val id: String) : ReviewGuideTarget

  /** [repo] is `owner/repo`; [headSha] is the head the client last saw, so a stale guide says so. */
  @Serializable data class PullRequest(val repo: String, val number: Int, val headSha: String? = null) : ReviewGuideTarget

  /** Where the guide's state and its draft comments are kept: a session's drafts are its review. */
  val key: String
    get() = when (this) {
      is Session -> id
      is PullRequest -> "pr:$repo#$number"
    }

  val sessionId: String? get() = (this as? Session)?.id

  /** What the drafts say they're about, as the agent prompt names it. */
  val scope: String
    get() = when (this) {
      is Session -> "changes on this branch"
      is PullRequest -> "pull request #$number"
    }
}

data class ReviewGuideAnswer(val question: String, val answer: String, val id: String = UUID.randomUUID().toString())

/**
 * Each target's guide as the host last described it, the diff it was written against,
 * the stops you've looked at, and the answers to your questions. In memory: a review is one sitting.
 */
class ReviewGuides {
  internal val _states = MutableStateFlow(emptyMap<String, RemoteReviewGuideState>())
  val states: StateFlow<Map<String, RemoteReviewGuideState>> = _states.asStateFlow()
  /** Each target's patch, parsed once per guide. */
  internal val _files = MutableStateFlow(emptyMap<String, List<DiffFile>>())
  val files: StateFlow<Map<String, List<DiffFile>>> = _files.asStateFlow()
  internal val _visited = MutableStateFlow(emptyMap<String, Set<String>>())
  val visited: StateFlow<Map<String, Set<String>>> = _visited.asStateFlow()
  /** Answers by `key/stopId`, newest last. */
  internal val _answers = MutableStateFlow(emptyMap<String, List<ReviewGuideAnswer>>())
  val answers: StateFlow<Map<String, List<ReviewGuideAnswer>>> = _answers.asStateFlow()
  internal val _asking = MutableStateFlow(emptySet<String>())
  val asking: StateFlow<Set<String>> = _asking.asStateFlow()
  internal val _errors = MutableStateFlow(emptyMap<String, String>())
  val errors: StateFlow<Map<String, String>> = _errors.asStateFlow()

  fun state(target: ReviewGuideTarget): RemoteReviewGuideState? = _states.value[target.key]

  fun visited(target: ReviewGuideTarget): Set<String> = _visited.value[target.key].orEmpty()

  fun answers(target: ReviewGuideTarget, stop: String): List<ReviewGuideAnswer> = _answers.value["${target.key}/$stop"].orEmpty()

  fun isAsking(target: ReviewGuideTarget, stop: String): Boolean = "${target.key}/$stop" in _asking.value

  /**
   * The stop's files from the guide's patch, each cut down to the hunks the stop points at
   * (every hunk when it points at none, as mechanical stops do).
   */
  fun files(target: ReviewGuideTarget, stop: RemoteReviewGuideStop): List<DiffFile> {
    val all = _files.value[target.key].orEmpty()
    return stop.paths.mapNotNull { path ->
      val file = all.firstOrNull { it.displayPath == path } ?: return@mapNotNull null
      val ranges = stop.ranges.filter { it.path == path }
      if (ranges.isEmpty()) return@mapNotNull file
      val hunks = file.hunks.filter { hunk -> ranges.any { overlaps(hunk, it) } }
      if (hunks.isEmpty()) file else file.copy(hunks = hunks)
    }
  }

  internal fun set(state: RemoteReviewGuideState, key: String) {
    if (_states.value[key]?.guide?.headSha != state.guide?.headSha || key !in _files.value) {
      _files.update { it + (key to (state.patch?.let(DiffParser::parse) ?: emptyList())) }
    }
    _states.update { it + (key to state) }
    _errors.update { it - key }
  }

  internal fun setError(key: String, message: String?) {
    _errors.update { if (message == null) it - key else it + (key to message) }
  }

  fun clear() {
    _states.value = emptyMap()
    _files.value = emptyMap()
    _visited.value = emptyMap()
    _answers.value = emptyMap()
    _asking.value = emptySet()
    _errors.value = emptyMap()
  }

  companion object {
    internal fun overlaps(hunk: DiffHunk, range: RemoteReviewGuideRange): Boolean {
      val numbers = hunk.lines.mapNotNull { if (range.side == RemoteReviewGuideRangeSide.old) it.oldNumber else it.newNumber }
      val low = numbers.minOrNull() ?: return false
      val high = numbers.maxOrNull() ?: return false
      return low <= range.end.toInt() && range.start.toInt() <= high
    }
  }
}

private data class GuideParams(val sessionId: String?, val repo: String?, val number: Long?, val headSha: String?)

private val ReviewGuideTarget.params: GuideParams
  get() = when (this) {
    is ReviewGuideTarget.Session -> GuideParams(id, null, null, null)
    is ReviewGuideTarget.PullRequest -> GuideParams(null, repo, number.toLong(), headSha)
  }

/** The target's guide as it stands; the screen keeps polling while one is being written. */
suspend fun HostStore.loadReviewGuide(target: ReviewGuideTarget) {
  val backend = backend ?: return
  val p = target.params
  try {
    val state = backend.request(Methods.ReviewGuidesGet, MethodsTypes.ReviewGuidesGetParams(p.sessionId, p.repo, p.number, p.headSha)).guide
    reviewGuides.set(state, target.key)
  } catch (e: Exception) {
    if (!HostStore.isQuiet(e)) reviewGuides.setError(target.key, HostStore.describe(e))
  }
}

/** Starts writing a guide; [force] rewrites one that already matches the head. */
suspend fun HostStore.generateReviewGuide(target: ReviewGuideTarget, force: Boolean = false) {
  val backend = backend ?: return
  val p = target.params
  try {
    val state = backend.request(
      Methods.ReviewGuidesGenerate,
      MethodsTypes.ReviewGuidesGenerateParams(p.sessionId, p.repo, p.number, p.headSha, if (force) true else null),
    ).guide
    reviewGuides.set(state, target.key)
    if (force) reviewGuides._visited.update { it - target.key }
  } catch (e: Exception) {
    reviewGuides.setError(target.key, HostStore.describe(e))
    report(e, "review_guide")
  }
}

fun HostStore.markStopVisited(target: ReviewGuideTarget, stop: String) {
  if (stop in reviewGuides.visited(target)) return
  reviewGuides._visited.update { it + (target.key to (it[target.key].orEmpty() + stop)) }
  val count = reviewGuides.state(target)?.guide?.stops?.size ?: 0
  if (count > 0 && reviewGuides.visited(target).size == count) {
    hooks.track(StoreEvent.ReviewGuideUsed(StoreEvent.ReviewGuideAction.Completed, count))
  }
}

/** Counted once per guide shown, not per poll. */
fun HostStore.trackReviewGuideOpened(target: ReviewGuideTarget) {
  hooks.track(StoreEvent.ReviewGuideUsed(StoreEvent.ReviewGuideAction.Open, reviewGuides.state(target)?.guide?.stops?.size ?: 0))
}

suspend fun HostStore.askAboutStop(target: ReviewGuideTarget, stop: String, question: String) {
  val backend = backend ?: return
  val key = "${target.key}/$stop"
  val p = target.params
  reviewGuides._asking.update { it + key }
  try {
    val answer = backend.request(
      Methods.ReviewGuidesAsk,
      MethodsTypes.ReviewGuidesAskParams(p.sessionId, p.repo, p.number, p.headSha, stop, question),
    ).answer
    reviewGuides._answers.update { it + (key to (it[key].orEmpty() + ReviewGuideAnswer(question, answer))) }
    reviewGuides.setError(target.key, null)
  } catch (e: Exception) {
    reviewGuides.setError(target.key, HostStore.describe(e))
    report(e, "review_guide")
  } finally {
    reviewGuides._asking.update { it - key }
  }
}

/** Posts a pull request's drafts as one review on its code host, then clears them. False when it failed. */
suspend fun HostStore.submitPullRequestReview(
  repo: String,
  number: Int,
  event: MethodsTypes.GithubReviewPullRequestParamsEvent,
  body: String,
): Boolean {
  val backend = backend ?: return false
  val key = ReviewGuideTarget.PullRequest(repo, number).key
  val comments = reviews.comments(key).map(PullRequestReviewComments::wire)
  return try {
    backend.request(Methods.GithubReviewPullRequest, MethodsTypes.GithubReviewPullRequestParams(repo, number.toLong(), event, body, comments))
    // The host counts the post; nothing to track here.
    reviews.clear(key)
    true
  } catch (e: Exception) {
    reviewGuides.setError(key, HostStore.describe(e))
    report(e, "review_guide")
    false
  }
}

object PullRequestReviewComments {
  /** A draft as an inline review comment: removed lines sit on the left side. */
  fun wire(comment: DiffReviewComment) = RemotePullRequestReviewComment(
    path = comment.path,
    side = if (comment.side == DiffReviewComment.Side.Old) RemotePullRequestReviewCommentSide.lEFT else RemotePullRequestReviewCommentSide.rIGHT,
    line = comment.lines.last.toLong(),
    startLine = if (comment.lines.first != comment.lines.last) comment.lines.first.toLong() else null,
    body = comment.body,
  )
}
