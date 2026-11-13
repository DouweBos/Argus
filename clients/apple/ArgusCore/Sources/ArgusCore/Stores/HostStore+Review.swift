import ArgusKit
import Foundation

/// Diff review: draft comments on lines, sent to a session's agent as one message,
/// or a fresh agent asked to review the diff.
extension HostStore {
  public func addReviewComment(_ comment: DiffReviewComment, sessionId: String) {
    reviews.add(comment, sessionId: sessionId)
    hooks.track(.diffReviewed(action: .comment, comments: reviews.comments(sessionId).count))
  }

  public func deleteReviewComment(_ id: UUID, sessionId: String) {
    reviews.remove(id, sessionId: sessionId)
    hooks.track(.diffReviewed(action: .delete, comments: reviews.comments(sessionId).count))
  }

  /// The user switched what a session's diff covers.
  public func trackDiffScope(_ scope: SessionDiffScope) {
    hooks.track(.diffScoped(scope: scope.kind))
  }

  public func discardReview(sessionId: String) {
    let count = reviews.comments(sessionId).count
    reviews.clear(sessionId)
    hooks.track(.diffReviewed(action: .discard, comments: count))
  }

  /// The session's agent to hand a review to: `preferring` while it's live, else the newest live one.
  public func frontAgent(inSession sessionId: String, preferring: String? = nil) -> String? {
    guard let repoRoot = repoRoot(forSessionId: sessionId) else { return nil }
    let live = agents(inSessionId: sessionId, repoRoot: repoRoot)
      .filter { $0.status != .stopped && $0.status != .error }
    if let preferring, live.contains(where: { $0.agentId == preferring }) { return preferring }
    return live.last?.agentId
  }

  /// Sends every draft as one message to the session's front agent, starting one if none is live.
  /// Returns the agent it went to; the drafts are cleared once it's handed over (a failed send stays retryable in the chat).
  @discardableResult
  public func sendReview(
    sessionId: String, preferring: String? = nil, defaults: AgentStartDefaults,
    onAgent: (@MainActor (_ agentId: String, _ started: Bool) -> Void)? = nil
  ) async -> String? {
    let comments = reviews.comments(sessionId)
    guard !comments.isEmpty else { return nil }
    var agentId = frontAgent(inSession: sessionId, preferring: preferring)
    let started = agentId == nil
    if agentId == nil {
      agentId = await startAgent(sessionId: sessionId, mode: defaults.mode, model: defaults.model)
    }
    guard let agentId else { return nil }
    reviews.clear(sessionId)
    hooks.track(.diffReviewed(action: .send, comments: comments.count))
    onAgent?(agentId, started)
    await sendMessage(
      agentId: agentId, message: DiffReviewPrompt.message(comments),
      displayText: DiffReviewPrompt.displayText(comments))
    return agentId
  }

  /// A new agent in the session, asked to review its diff and report without editing.
  @discardableResult
  public func requestCodeReview(
    sessionId: String, baseBranch: String?, defaults: AgentStartDefaults,
    onSpawned: (@MainActor (_ agentId: String, _ sessionId: String) -> Void)? = nil
  ) async -> String? {
    let prompt = DiffReviewPrompt.reviewRequest(baseBranch: baseBranch)
    let agentId = await startAgent(
      inSession: sessionId, with: ComposerStart(message: prompt.message, displayText: prompt.displayText),
      defaults: defaults, onSpawned: onSpawned)
    if agentId != nil {
      hooks.track(.diffReviewed(action: .requestReview, comments: reviews.comments(sessionId).count))
    }
    return agentId
  }
}
