import AppIntents
import ArgusCore
import Foundation

struct RunAutomationIntent: AppIntent {
  static let title: LocalizedStringResource = "Run Automation"
  static let description = IntentDescription("Runs a saved automation now, whatever its schedule.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Automation", requestValueDialog: "Which automation?")
  var automation: AutomationEntity

  static var parameterSummary: some ParameterSummary { Summary("Run \(\.$automation)") }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let run = IntentRun(.runAutomation)
    defer { run.finish() }
    let app = try await IntentHost.connect(automation.hostId, control: true)
    let store = AutomationsStore(host: app.host)
    let before = Date.now.timeIntervalSince1970 * 1000 - 5000
    await store.runNow(automationId: automation.automationId)
    if let error = store.error { throw IntentFailure.failed("\(error)") }
    let started = store.runs.first { $0.automationId == automation.automationId && $0.startedAt >= before }
    if started?.status == .skipped {
      return .result(dialog: "\(automation.name) was skipped: \(started?.triggerReason ?? "the computer refused it").")
    }
    run.success = true
    return .result(dialog: "Started \(automation.name).")
  }
}

struct OpenSessionIntent: OpenIntent {
  static let title: LocalizedStringResource = "Open Session"
  static let description = IntentDescription("Opens a session in Argus.")

  @Parameter(title: "Session", requestValueDialog: "Which session?")
  var target: SessionEntity

  @MainActor
  func perform() async throws -> some IntentResult {
    let run = IntentRun(.openSession)
    defer { run.finish() }
    NotificationRouter.shared.open(
      ArgusLocation(route: .session(id: target.sessionId, agentId: nil), host: target.hostId), via: .shortcut)
    run.success = true
    return .result()
  }
}

/// What Siri and Spotlight offer without any setup. Phrases can only carry
/// entity parameters, so Siri asks for a prompt or message out loud.
struct ArgusShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartAgentIntent(),
      phrases: [
        "Ask \(.applicationName) to start an agent on \(\.$project)",
        "Start an \(.applicationName) agent on \(\.$project)",
        "Ask \(.applicationName) to start an agent",
      ],
      shortTitle: "Start Agent", systemImageName: "sparkles")
    AppShortcut(
      intent: AgentsNeedingMeIntent(),
      phrases: [
        "Which \(.applicationName) agents need me",
        "Ask \(.applicationName) what needs me",
        "What's waiting in \(.applicationName)",
      ],
      shortTitle: "Agents Needing Me", systemImageName: "bell.badge")
    AppShortcut(
      intent: ApproveRequestIntent(),
      phrases: [
        "Approve the \(.applicationName) request",
        "Ask \(.applicationName) to approve \(\.$agent)",
      ],
      shortTitle: "Approve Request", systemImageName: "checkmark.shield")
    AppShortcut(
      intent: SendMessageIntent(),
      phrases: [
        "Ask \(.applicationName) to message \(\.$agent)",
        "Send a message in \(.applicationName)",
      ],
      shortTitle: "Message Agent", systemImageName: "bubble.left")
    AppShortcut(
      intent: RunAutomationIntent(),
      phrases: [
        "Ask \(.applicationName) to run \(\.$automation)",
        "Run an \(.applicationName) automation",
      ],
      shortTitle: "Run Automation", systemImageName: "bolt")
    AppShortcut(
      intent: OpenSessionIntent(),
      phrases: [
        "Open \(\.$target) in \(.applicationName)",
        "Open an \(.applicationName) session",
      ],
      shortTitle: "Open Session", systemImageName: "rectangle.stack")
  }
}
