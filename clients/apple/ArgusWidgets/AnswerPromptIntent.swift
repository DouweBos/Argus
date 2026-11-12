import AppIntents
import ArgusKit

/// Approve or Deny from the agents' Live Activity. Shared with the app target:
/// a `LiveActivityIntent` runs in the app's process, which holds the connection.
struct AnswerPromptIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Answer Agent Prompt"
  static let isDiscoverable = false
  // Approving runs code on the computer, so a locked phone asks for Face ID first.
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Computer") var hostId: String
  @Parameter(title: "Agent") var agentId: String
  @Parameter(title: "Prompt") var toolUseId: String
  @Parameter(title: "Approve") var allow: Bool

  init() {}

  init(hostId: String, agentId: String, toolUseId: String, allow: Bool) {
    self.hostId = hostId
    self.agentId = agentId
    self.toolUseId = toolUseId
    self.allow = allow
  }

  @MainActor
  func perform() async throws -> some IntentResult {
    await AgentActivityActions.answer?(
      .init(hostId: hostId, agentId: agentId, toolUseId: toolUseId, allow: allow))
    return .result()
  }
}
