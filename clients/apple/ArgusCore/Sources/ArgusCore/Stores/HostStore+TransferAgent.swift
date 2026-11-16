import ArgusKit
import Foundation

/// "Move to": the chat goes on in another session, in this project or another,
/// and the old agent stops. The host captures telemetry.
extension HostStore {
  /// One project's places a chat can move to.
  public struct MoveDestination: Identifiable, Sendable {
    public let project: RemoteProject
    /// Ready sessions to join, minus the chat's own and finished ones.
    public let sessions: [RemoteSession]
    public var id: String { project.repoRoot }
  }

  /// Every project, the chat's own first, with the sessions it could join.
  public func moveDestinations(agentId: String) -> [MoveDestination] {
    let here = statusByAgent[agentId]?.sessionId
    let hereRepo = here.flatMap { id in sessionsByRepo.values.joined().first { $0.id == id }?.repoRoot }
    let ordered = projects.filter { $0.repoRoot == hereRepo } + projects.filter { $0.repoRoot != hereRepo }
    return ordered.map { project in
      let sessions = (sessionsByRepo[project.repoRoot] ?? []).filter {
        $0.id != here && $0.status == .ready && !$0.isUnavailable && !$0.isOutsideProjects && !$0.isDone
      }
      return MoveDestination(project: project, sessions: sessions)
    }
  }

  /// Where a chat went: its session, and its agent unless that waits on a new session's setup.
  public struct MovedChat: Sendable {
    public let sessionId: String
    public let agent: RemoteAgentStatus?
  }

  /// Moves the chat into `sessionId`, or a new session in `repoRoot`.
  public func transferAgent(
    agentId: String, sessionId: String? = nil, repoRoot: String? = nil
  ) async throws -> MovedChat {
    guard let backend else { throw Transport.TransportError.notReady }
    struct Result: Decodable {
      let sessionId: String
      let agent: RemoteAgentStatus?
      enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case agent
      }
    }
    let result = try await backend.request(
      .agentsTransfer,
      ArgusProtocol.MethodsTypes.AgentsTransferParams(agentId: agentId, sessionId: sessionId, repoRoot: repoRoot),
      as: Result.self)
    if let agent = result.agent { statusByAgent[agent.agentId] = agent }
    return MovedChat(sessionId: result.sessionId, agent: result.agent)
  }
}
