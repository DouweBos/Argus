package dev.houwert.argus.core.stores

import dev.houwert.argus.core.git.DiffReviewComment
import dev.houwert.argus.core.git.DiffReviewPrompt
import dev.houwert.argus.core.git.SessionDiffScope
import dev.houwert.argus.core.sessions.AgentStartDefaults
import dev.houwert.argus.core.sessions.ComposerStart
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus

// Diff review: draft comments on lines, sent to a session's agent as one message,
// or a fresh agent asked to review the diff.

fun HostStore.addReviewComment(comment: DiffReviewComment, sessionId: String) {
  reviews.add(comment, sessionId)
  hooks.track(StoreEvent.DiffReviewed(StoreEvent.DiffReviewAction.Comment, reviews.comments(sessionId).size))
}

fun HostStore.deleteReviewComment(id: String, sessionId: String) {
  reviews.remove(id, sessionId)
  hooks.track(StoreEvent.DiffReviewed(StoreEvent.DiffReviewAction.Delete, reviews.comments(sessionId).size))
}

/** The user switched what a session's diff covers. */
fun HostStore.trackDiffScope(scope: SessionDiffScope) {
  hooks.track(StoreEvent.DiffScoped(scope.kind))
}

fun HostStore.discardReview(sessionId: String) {
  val count = reviews.comments(sessionId).size
  reviews.clear(sessionId)
  hooks.track(StoreEvent.DiffReviewed(StoreEvent.DiffReviewAction.Discard, count))
}

/** The session's agent to hand a review to: [preferring] while it's live, else the newest live one. */
fun HostStore.frontAgent(inSession: String, preferring: String? = null): String? {
  val repoRoot = repoRoot(inSession) ?: return null
  val live = agents(inSession, repoRoot).filter { it.status != RemoteAgentStatusStatus.stopped && it.status != RemoteAgentStatusStatus.error }
  if (preferring != null && live.any { it.agentId == preferring }) return preferring
  return live.lastOrNull()?.agentId
}

/**
 * Sends every draft as one message to the session's front agent, starting one if none is live.
 * Returns the agent it went to; the drafts clear once it's handed over (a failed send stays retryable in the chat).
 */
suspend fun HostStore.sendReview(
  sessionId: String,
  preferring: String? = null,
  defaults: AgentStartDefaults = AgentStartDefaults(),
): String? {
  val comments = reviews.comments(sessionId)
  if (comments.isEmpty()) return null
  val agentId = frontAgent(sessionId, preferring)
    ?: startAgent(sessionId, defaults.mode, defaults.model)
    ?: return null
  reviews.clear(sessionId)
  hooks.track(StoreEvent.DiffReviewed(StoreEvent.DiffReviewAction.Send, comments.size))
  sendMessage(agentId, DiffReviewPrompt.message(comments), displayText = DiffReviewPrompt.displayText(comments))
  return agentId
}

/** A new agent in the session, asked to review its diff and report without editing. */
suspend fun HostStore.requestCodeReview(
  sessionId: String,
  baseBranch: String?,
  defaults: AgentStartDefaults = AgentStartDefaults(),
  onSpawned: ((agentId: String, sessionId: String) -> Unit)? = null,
): String? {
  val (message, display) = DiffReviewPrompt.reviewRequest(baseBranch)
  val agentId = startAgent(sessionId, ComposerStart(message, display), defaults, onSpawned) ?: return null
  hooks.track(StoreEvent.DiffReviewed(StoreEvent.DiffReviewAction.RequestReview, reviews.comments(sessionId).size))
  return agentId
}
