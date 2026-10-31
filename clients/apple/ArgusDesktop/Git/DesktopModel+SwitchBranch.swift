import ArgusCore
import ArgusUI

/// Switching a session's checkout from outside the git panel: the start
/// composer and the context card list local branches and check one out.
extension DesktopModel {
  /// The repo's local branches; nil when they couldn't be read.
  func localBranches(repoRoot: String) async -> [String]? {
    guard let backend else { return nil }
    return try? await backend.request(ArgusProtocol.Commands.ListAllBranches.self, .init(repoRoot: repoRoot)).local
  }

  /// Through the git panel's checkout, so a dirty tree still asks to stash or discard.
  func switchBranch(_ session: RemoteSession, to branch: String, theme: Theme) async {
    guard branch != session.branch, let git = await git.open(session) else { return }
    await RefActions(workspace: git, session: session, model: self, theme: theme).checkout(branch)
    await store.loadSessions(repoRoot: session.repoRoot)
    await store.loadGitStatus(sessionId: session.id)
  }
}
