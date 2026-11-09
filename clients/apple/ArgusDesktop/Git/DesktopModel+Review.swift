import ArgusCore
import Foundation

extension DesktopModel {
  /// Sends the session's draft comments to its front agent as one message, then shows that agent.
  func sendReview(session id: String) async {
    await store.sendReview(sessionId: id, preferring: lastAgents[id], defaults: startDefaults) { [weak self] agentId, started in
      guard let self else { return }
      if started {
        open(spawned: agentId, session: id)
      } else {
        navigate(.session(id: id, agentId: agentId))
      }
    }
  }

  /// A new agent in the session, asked to review its diff before a commit; opened once it starts.
  func requestCodeReview(session id: String) async {
    let session = session(id)
    let base = session?.kind == .worktree ? session?.baseBranch : nil
    await store.requestCodeReview(sessionId: id, baseBranch: base, defaults: startDefaults) { [weak self] agentId, sessionId in
      self?.open(spawned: agentId, session: sessionId)
    }
  }
}
