import ArgusKit
import Foundation

/// One live agent as the conversation owner tracks it — the renderer's
/// `agentStore` entry.
public struct LiveAgent: Identifiable, Hashable, Sendable {
  public var id: String
  public var sessionId: String
  public var parentAgentId: String?
  public var runnerId: String?
  public var createdAt: Double
  /// This app's view of the agent: `running` the moment a message goes out,
  /// settled by the host's `idle`.
  public var status: RemoteAgentState
  public var model: String?
  public var permissionMode: String?
  public var effort: String?
}

/// What saving and notifications need to know about an agent's session.
struct LiveSession: Sendable {
  var repoRoot: String
  var branch: String
  var description: String
  var displayName: String?
}

/// `agent:started`: the host's `AgentInfo`, plus the prompt a backend spawn
/// was handed.
struct AgentStartedPayload: Decodable {
  let agent_id: String
  let session_id: String
  let status: String?
  let permission_mode: String?
  let parent_agent_id: String?
  let created_at: Double?
  let model: String?
  let runner_id: String?
  let initial_prompt: String?
}

/// `agent:mcp-message`: a prompt the MCP server injected on an agent's behalf.
struct McpMessagePayload: Decodable {
  let message: String
  let images: [ConversationImage]?
  let parentAgentId: String?
  let parentLabel: String?
  let timestamp: Double?
  let tool: String
}

/// `agent:remote-message`: a send the host made for another client.
struct RemoteMessagePayload: Decodable {
  let message: String
  let images: [ConversationImage]?
  let author: String?
}

/// `agent_notification_clicked`.
struct NotificationClickedPayload: Decodable {
  let agent_id: String
  let session_id: String
}

/// The raw broadcast a console connection receives as an `ipc` event.
struct IpcPayload: Decodable {
  let channel: String
  let args: [JSONValue]?
}

/// The outcome of an agent's last `result`, announced once its turn is over.
struct FinishedTurn {
  let durationMs: Double
  let failed: Bool
}
