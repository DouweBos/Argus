import ArgusKit
import Foundation

/// Port of `agentNotifications.ts`: when to ask the host to notify, and what
/// to say. The host fans it out to paired devices and, when `showLocal`, hands
/// the banner back to this app through platform delegation.
extension LiveAgents {
  /// A quick successful turn isn't worth interrupting anyone for.
  static let minTurnDurationMs: Double = 10_000

  /// Tools that stop and wait for the user even when nothing asked permission:
  /// in `auto` mode the CLI approves them itself, so no request ever arrives.
  static func awaitsAnswer(_ toolName: String) -> Bool {
    toolName == "AskUserQuestion" || toolName == "ExitPlanMode"
  }

  func notifyAgentFinished(_ agentId: String, durationMs: Double, failed: Bool) {
    if !failed && durationMs < Self.minTurnDurationMs { return }
    let context = notificationContext(agentId)
    let seconds = max(1, Int((durationMs / 1000).rounded()))
    dispatch(
      .init(
        agentId: agentId, body: failed
          ? "\(context.session) - \(context.agent) ended with an error"
          : "\(context.session) - \(context.agent) completed in \(seconds)s",
        kind: failed ? .failed : .finished, sessionId: context.sessionId,
        title: failed ? "\(context.project) agent failed" : "\(context.project) agent finished"))
  }

  /// A question or plan the user hasn't answered once the grace period is up.
  func notifyIfStillUnanswered(_ agentId: String, toolUseId: String, toolName: String) {
    let grace = timing.awaitingAnswerGrace
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: grace)
      guard let self else { return }
      let answered = self.conversations[agentId]?.messages.contains { message in
        message.toolCalls.contains { $0.id == toolUseId && $0.result != nil }
      } ?? false
      if !answered { self.notifyAwaitingAnswer(agentId, toolUseId: toolUseId, toolName: toolName) }
    }
  }

  func notifyAwaitingAnswer(_ agentId: String, toolUseId: String, toolName: String) {
    guard notified.claim("\(agentId):\(toolUseId)") else { return }
    let context = notificationContext(agentId)
    let what = toolName == "ExitPlanMode" ? "wants to run its plan by you" : "asked you a question"
    dispatch(
      .init(
        agentId: agentId, body: "\(context.session) - \(context.agent) \(what)",
        kind: .permission, sessionId: context.sessionId,
        title: "\(context.project) agent needs you", toolName: toolName, toolUseId: toolUseId))
  }

  func notifyPermissionRequested(_ request: RemotePermissionRequest) {
    let agentId = request.agentId
    guard notified.claim("\(agentId):\(request.toolUseId)") else { return }
    let context = notificationContext(agentId)
    dispatch(
      .init(
        agentId: agentId,
        body: "\(context.session) - \(context.agent) requested \(request.toolName)",
        kind: .permission, sessionId: context.sessionId,
        title: "\(context.project) agent needs approval", toolName: request.toolName,
        toolUseId: request.toolUseId))
  }

  private struct NotificationContext {
    let sessionId: String?
    let session: String
    let project: String
    let agent: String
  }

  private func notificationContext(_ agentId: String) -> NotificationContext {
    let sessionId = agents[agentId]?.sessionId
    let session = sessionId.flatMap { sessions[$0] }
    let project = session.flatMap { ($0.repoRoot as NSString).lastPathComponent }
    let title = conversations[agentId]?.title?.trimmingCharacters(in: .whitespacesAndNewlines)
    return NotificationContext(
      sessionId: sessionId,
      session: session?.displayName ?? session?.branch ?? "session",
      project: project.flatMap { $0.isEmpty || $0 == "/" ? nil : $0 } ?? "Project",
      agent: (title?.isEmpty ?? true) ? "Agent" : conversations[agentId]!.title!)
  }

  /// A banner on this Mac only when you aren't already looking at the app.
  private func dispatch(_ payload: ArgusProtocol.AgentNotificationInput) {
    guard let backend else { return }
    let showLocal = !(store?.hooks.isAppFocused() ?? true)
    Task {
      _ = try? await backend.request(
        ArgusProtocol.Commands.NotifyAgent.self, .init(payload: payload, showLocal: showLocal))
    }
  }
}
