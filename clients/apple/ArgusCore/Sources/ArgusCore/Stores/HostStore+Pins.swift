import ArgusKit
import Foundation

/// Pinned chats: the host resumes them on its next start. The host owns the pin and captures its telemetry.
extension HostStore {
  public func isPinned(agentId: String) -> Bool {
    statusByAgent[agentId]?.isPinned == true
  }

  /// Pinning needs the agent live; unpinning works on one already stopped.
  public func canTogglePin(agentId: String) -> Bool {
    guard let status = statusByAgent[agentId] else { return false }
    return status.isPinned || (status.status != .stopped && status.status != .error)
  }

  public func setPinned(agentId: String, pinned: Bool) async {
    guard
      let result = await requestPin(
        ArgusProtocol.MethodsTypes.AgentsSetPinnedParams(agentId: agentId, pinned: pinned))
    else { return }
    statusByAgent[agentId]?.pinned = result
  }

  /// Pin a saved chat; it comes back on the next start under the agent id it last ran as.
  public func setPinned(chat: RemoteStoppedAgent, repoRoot: String, pinned: Bool) async {
    guard
      let result = await requestPin(
        ArgusProtocol.MethodsTypes.AgentsSetPinnedParams(
          repoRoot: repoRoot, historyId: chat.historyId, pinned: pinned))
    else { return }
    if let index = stoppedByRepo[repoRoot]?.firstIndex(where: { $0.historyId == chat.historyId }) {
      stoppedByRepo[repoRoot]?[index].pinned = result
    }
  }

  /// A hand-resumed agent takes over its conversation's pin from the stopped one.
  func notePinMoved(from oldAgentId: String, to resumed: RemoteAgentStatus) {
    guard resumed.isPinned else { return }
    statusByAgent[oldAgentId]?.pinned = false
  }

  private func requestPin(_ params: ArgusProtocol.MethodsTypes.AgentsSetPinnedParams) async -> Bool? {
    guard let backend else { return nil }
    do {
      return try await backend.request(
        .agentsSetPinned, params, as: ArgusProtocol.MethodsTypes.AgentsSetPinnedResult.self
      ).pinned
    } catch {
      report(error)
      return nil
    }
  }
}
