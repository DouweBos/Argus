import ArgusCore
import Foundation

extension DesktopModel {
  /// Starts an agent in a session with Settings' default mode unless the caller picked one.
  /// Returns its id, or nil when it didn't start (the store reports why).
  func startAgent(sessionId: String, mode: RemotePermissionMode? = nil) async -> String? {
    let fallback = AppPreferences.shared.defaultPermissionMode
    if let remoteMode = mode ?? RemotePermissionMode(rawValue: fallback.rawValue) {
      return await store.spawnAgent(sessionId: sessionId, permissionMode: remoteMode)?.agentId
    }
    return await startTrusted(sessionId: sessionId, mode: fallback.rawValue)
  }

  /// `trusted` is a CLI flag fixed at launch, and the gateway's spawn refuses
  /// it; the admin command takes any mode and announces the agent the same way.
  private func startTrusted(sessionId: String, mode: String) async -> String? {
    guard let backend = store.backend else { return nil }
    do {
      let info = try await backend.request(
        ArgusProtocol.Commands.StartAgent.self, .init(sessionId: sessionId, permissionMode: mode))
      if let repoRoot = session(sessionId)?.repoRoot { await store.loadAgents(repoRoot: repoRoot) }
      return info.agentId
    } catch {
      store.report(error)
      return nil
    }
  }
}
