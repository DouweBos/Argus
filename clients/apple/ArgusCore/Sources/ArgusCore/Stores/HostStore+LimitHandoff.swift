import ArgusKit
import Foundation

/// Moving a chat stalled on a spent usage limit onto another of the computer's
/// Claude accounts. Only on the user's pick; the host captures the telemetry.
extension HostStore {
  /// Other accounts the agent could continue on; empty once the stall is over.
  public func limitHandoffAccounts(agentId: String) async -> [ArgusProtocol.LimitHandoffAccount] {
    guard let backend else { return [] }
    let result = try? await backend.request(
      .agentsLimitHandoff,
      ArgusProtocol.MethodsTypes.AgentsLimitHandoffParams(agentId: agentId),
      as: ArgusProtocol.MethodsTypes.AgentsLimitHandoffResult.self)
    return result?.accounts ?? []
  }

  /// Pin the session to `accountId`, move the agent there and continue its turn.
  /// Throws the host's reason so the card can show it in place.
  public func handoffAgent(agentId: String, accountId: String) async throws {
    guard let backend else { return }
    try await backend.request(
      .agentsHandoffToAccount,
      ArgusProtocol.MethodsTypes.AgentsHandoffToAccountParams(agentId: agentId, accountId: accountId),
      as: IgnoredResult.self)
    // Nothing re-broadcasts the session list on this write.
    guard let sessionId = statusByAgent[agentId]?.sessionId else { return }
    for (repoRoot, sessions) in sessionsByRepo {
      guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { continue }
      sessionsByRepo[repoRoot]?[index].claudeAccountId = accountId
    }
  }
}
