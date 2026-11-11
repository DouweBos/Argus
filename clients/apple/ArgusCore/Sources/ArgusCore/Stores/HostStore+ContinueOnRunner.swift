import ArgusKit
import Foundation

/// "Continue on…": the chat goes on in a new agent on another runner, in the
/// same session, seeded with what happened so far. The host captures telemetry.
extension HostStore {
  public enum ContinueSource: String, Sendable {
    case limitCard = "limit_card"
    case menu
  }

  /// Installed runners other than the agent's own.
  public func continueRunners(agentId: String) -> [RemoteRunner] {
    let current = statusByAgent[agentId]?.runnerId ?? "claude-code"
    return runners.filter { $0.isAvailable && $0.id != current }
  }

  /// Between turns: two agents on one task in one worktree would collide.
  public func canContinueElsewhere(agentId: String) -> Bool {
    guard let status = statusByAgent[agentId]?.status else { return false }
    return status != .running
  }

  /// Starts the new agent and returns it; throws the host's reason.
  public func continueOnRunner(
    agentId: String, runnerId: String, source: ContinueSource
  ) async throws -> RemoteAgentStatus {
    guard let backend else { throw Transport.TransportError.notReady }
    struct Result: Decodable { let agent: RemoteAgentStatus }
    let result = try await backend.request(
      .agentsContinueOnRunner,
      ArgusProtocol.MethodsTypes.AgentsContinueOnRunnerParams(
        agentId: agentId, runnerId: runnerId, source: .init(rawValue: source.rawValue)),
      as: Result.self)
    statusByAgent[result.agent.agentId] = result.agent
    return result.agent
  }
}
