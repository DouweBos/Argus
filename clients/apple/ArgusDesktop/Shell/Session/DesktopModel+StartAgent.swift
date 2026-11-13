import ArgusCore
import ArgusUI
import Foundation

extension DesktopModel {
  /// Settings' default mode and model, for the agent a start leaves them open on.
  var startDefaults: AgentStartDefaults {
    AgentStartDefaults(mode: AppPreferences.shared.defaultPermissionMode.rawValue, model: Self.defaultModel)
  }

  /// Starts an agent in a session with Settings' default mode unless the caller picked one.
  /// Returns its id, or nil when it didn't start (the store reports why).
  func startAgent(sessionId: String, mode: RemotePermissionMode? = nil, model: String? = nil) async -> String? {
    await store.startAgent(sessionId: sessionId, mode: mode?.rawValue ?? startDefaults.mode, model: model)
  }

  /// The start composer's send: an agent in the session, opened, with the message as its first turn.
  func startAgent(inSession id: String, with request: ComposerStart) async -> Bool {
    await store.startAgent(inSession: id, with: request, defaults: startDefaults) { [weak self] agentId, _ in
      self?.open(spawned: agentId, session: id)
    } != nil
  }

  /// A session's start composer, defaulting to Settings' permission mode and model.
  func composerStarter(session id: String) -> ComposerStarter {
    ComposerStarter(
      defaultMode: AppPreferences.shared.defaultPermissionMode.rawValue, defaultModel: Self.defaultModel
    ) { [weak self] request in
      await self?.startAgent(inSession: id, with: request) ?? false
    }
  }

  /// Sends to a new worktree off `baseBranch` instead; the host names its branch from the text.
  /// `replacing` is the empty agent the composer belonged to, closed once the worktree exists.
  func worktreeStarter(repoRoot: String, baseBranch: String?, replacing agentId: String? = nil) -> ComposerStarter {
    ComposerStarter(
      defaultMode: AppPreferences.shared.defaultPermissionMode.rawValue, defaultModel: Self.defaultModel,
      needsText: true, offersCompare: true
    ) { [weak self] request in
      guard let self else { return false }
      return await startInNewWorktree(
        repoRoot: repoRoot, baseBranch: baseBranch, request: request, replacing: agentId)
    }
  }

  private func startInNewWorktree(
    repoRoot: String, baseBranch: String?, request: ComposerStart, replacing agentId: String?
  ) async -> Bool {
    guard
      let session = await store.startInNewWorktree(
        repoRoot: repoRoot, baseBranch: baseBranch, request: request, defaults: startDefaults,
        onSpawned: { [weak self] spawned, sessionId in
          // Opened only if its session is still on screen.
          guard let self, route.sessionId == sessionId else { return }
          open(spawned: spawned, session: sessionId)
        })
    else { return false }
    if let agentId { await store.stopAgent(agentId: agentId) }
    if let group = session.compareGroup {
      navigate(.compareRun(groupId: group.id))
    } else {
      openAgents(session: session.id)
    }
    return true
  }

  /// Settings → LLM's default model; empty there is the runner's own.
  static var defaultModel: String? {
    let model = AppPreferences.shared.defaultLlmModel
    return model.isEmpty ? nil : model
  }
}
