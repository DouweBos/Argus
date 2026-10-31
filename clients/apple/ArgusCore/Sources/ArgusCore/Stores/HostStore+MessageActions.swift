import ArgusKit
import Foundation

/// Edit and fork from a message. Both throw, so a sheet can show why it failed
/// and stay open; the caller counts the outcome in its own telemetry catalog.
extension HostStore {
  public enum MessageForkTarget: String, Sendable, CaseIterable {
    /// A new session branched at the message.
    case session
    /// A new agent in the message's own session.
    case agent
  }

  public struct ForkedChat: Sendable {
    public let sessionId: String
    public let agent: RemoteAgentStatus
  }

  /// Rewind the conversation to `message` and send `edited` in its place; everything after it is discarded.
  public func rewind(agentId: String, message: RemoteMessage, edited: String) async throws {
    guard let backend else { throw Transport.TransportError.notReady }
    try await backend.request(
      .agentsRewind,
      ArgusProtocol.MethodsTypes.AgentsRewindParams(
        agentId: agentId, messageId: message.id, text: message.resendText(editing: edited)),
      as: ArgusProtocol.MethodsTypes.AgentsRewindResult.self)
  }

  /// Fork the chat up to `message` into a new agent; the host seeds its transcript.
  public func fork(
    agentId: String, message: RemoteMessage, into target: MessageForkTarget,
    description: String? = nil, branch: String? = nil
  ) async throws -> ForkedChat {
    guard let backend else { throw Transport.TransportError.notReady }
    // The app's own `RemoteAgentStatus`, not the generated one the stores don't hold.
    struct Result: Decodable {
      let sessionId: String
      let agent: RemoteAgentStatus
      enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case agent
      }
    }
    let result = try await backend.request(
      .agentsFork,
      ArgusProtocol.MethodsTypes.AgentsForkParams(
        agentId: agentId, messageId: message.id, into: .init(rawValue: target.rawValue),
        description: description.flatMap(Self.nonBlank), branch: branch.flatMap(Self.nonBlank)),
      as: Result.self)
    statusByAgent[result.agent.agentId] = result.agent
    // A forked session lands in the source's project; list it before anyone opens it.
    let source = statusByAgent[agentId]?.sessionId
    if let repoRoot = source.flatMap({ repoRoot(forSessionId: $0) }) {
      if target == .session { await loadSessions(repoRoot: repoRoot) }
      await loadAgents(repoRoot: repoRoot)
    }
    return ForkedChat(sessionId: result.sessionId, agent: result.agent)
  }

  private nonisolated static func nonBlank(_ text: String) -> String? {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}
