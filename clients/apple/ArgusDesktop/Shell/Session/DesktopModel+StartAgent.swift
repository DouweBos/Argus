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
  func startAgent(inSession id: String, with request: ComposerStart) async -> Bool {
    guard let agentId = await startAgent(sessionId: id, mode: request.permissionMode, model: request.model) else {
      return false
    }
    let send = Task {
      await store.sendMessage(
        agentId: agentId, message: request.message, images: request.images, displayText: request.displayText)
    }
    open(spawned: agentId, session: id)
    await send.value
    return true
  }

  /// A session's start composer, defaulting to Settings' permission mode.
  func composerStarter(session id: String) -> ComposerStarter {
    ComposerStarter(defaultMode: AppPreferences.shared.defaultPermissionMode.rawValue) { [weak self] request in
      await self?.startAgent(inSession: id, with: request) ?? false
    }
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
