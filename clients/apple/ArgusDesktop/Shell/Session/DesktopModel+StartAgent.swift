import ArgusCore
import ArgusUI
import Foundation

extension DesktopModel {
  /// Starts an agent in a session with Settings' default mode unless the caller picked one.
  /// Returns its id, or nil when it didn't start (the store reports why).
  func startAgent(sessionId: String, mode: RemotePermissionMode? = nil, model: String? = nil) async -> String? {
    let fallback = AppPreferences.shared.defaultPermissionMode
    if let remoteMode = mode ?? RemotePermissionMode(rawValue: fallback.rawValue) {
      return await store.spawnAgent(sessionId: sessionId, model: model, permissionMode: remoteMode)?.agentId
    }
    return await startTrusted(sessionId: sessionId, mode: fallback.rawValue, model: model)
  }

  /// The start composer's send: an agent in the session, opened, with the message as its first turn.
  func startAgent(inSession id: String, with request: ComposerStart, opening: Bool = true) async -> Bool {
    guard
      let agentId = await startAgent(
        sessionId: id, mode: request.permissionMode, model: request.model ?? Self.defaultModel)
    else {
      return false
    }
    if let effort = request.effort { await store.setEffort(agentId: agentId, level: effort) }
    let send = Task {
      await store.sendMessage(
        agentId: agentId, message: request.message, images: request.images, displayText: request.displayText)
    }
    if opening { open(spawned: agentId, session: id) }
    await send.value
    return true
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
      needsText: true
    ) { [weak self] request in
      guard let self else { return false }
      return await startInNewWorktree(
        repoRoot: repoRoot, baseBranch: baseBranch, request: request, replacing: agentId)
    }
  }

  /// Text alone rides the session's own prompt, which the host starts once setup
  /// finishes; images and effort can't, so the app starts that agent itself.
  private func startInNewWorktree(
    repoRoot: String, baseBranch: String?, request: ComposerStart, replacing agentId: String?
  ) async -> Bool {
    let hostStarts = request.images.isEmpty && request.effort == nil
    let mode = request.permissionMode
      ?? RemotePermissionMode(rawValue: AppPreferences.shared.defaultPermissionMode.rawValue)
    guard
      let session = await store.createSession(
        repoRoot: repoRoot, branch: "", description: request.displayText, baseBranch: baseBranch,
        prompt: hostStarts ? request.message : nil, model: request.model ?? Self.defaultModel,
        permissionMode: mode)
    else { return false }
    if let agentId { await store.stopAgent(agentId: agentId) }
    openAgents(session: session.id)
    if !hostStarts {
      Task { await startWhenReady(session.id, request: request) }
    }
    return true
  }

  /// Waits out the worktree's setup, then starts its agent; opened only if it's still on screen.
  private func startWhenReady(_ id: String, request: ComposerStart) async {
    let deadline = Date.now.addingTimeInterval(30 * 60)
    while Date.now < deadline {
      switch session(id)?.status {
      case .ready:
        _ = await startAgent(inSession: id, with: request, opening: route.sessionId == id)
        return
      case .error, .deleting:
        return
      default:
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }

  /// Settings' default model; empty there is the runner's own.
  static var defaultModel: String? {
    let model = AppPreferences.shared.defaultModel
    return model.isEmpty ? nil : model
  }

  /// `trusted` is a CLI flag fixed at launch, and the gateway's spawn refuses
  /// it; the admin command takes any mode and announces the agent the same way.
  private func startTrusted(sessionId: String, mode: String, model: String?) async -> String? {
    guard let backend = store.backend else { return nil }
    do {
      let info = try await backend.request(
        ArgusProtocol.Commands.StartAgent.self, .init(sessionId: sessionId, model: model, permissionMode: mode))
      if let repoRoot = session(sessionId)?.repoRoot { await store.loadAgents(repoRoot: repoRoot) }
      return info.agentId
    } catch {
      store.report(error)
      return nil
    }
  }
}
