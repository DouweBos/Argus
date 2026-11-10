import AppIntents
import ArgusCore
import Foundation

/// Counts an intent run once, however it ends.
@MainActor
final class IntentRun {
  private let intent: TelemetryEvent.IntentKind
  var success = false

  init(_ intent: TelemetryEvent.IntentKind) { self.intent = intent }

  func finish() { Telemetry.capture(.intentRun(intent: intent, success: success)) }
}

struct StartAgentIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Agent"
  static let description = IntentDescription("Starts an agent in a new worktree of a project, with your prompt as its first message.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Computer", description: "Defaults to the computer Argus was last on.")
  var computer: ComputerEntity?

  @Parameter(title: "Project", requestValueDialog: "Which project?")
  var project: ProjectEntity

  @Parameter(title: "Prompt", inputOptions: .init(multiline: true), requestValueDialog: "What should the agent do?")
  var prompt: String

  @Parameter(title: "Runner", description: "Defaults to the computer's own.")
  var runner: RunnerEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Start an agent on \(\.$project) to \(\.$prompt)") {
      \.$runner
      \.$computer
    }
  }

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<SessionEntity> & ProvidesDialog {
    let run = IntentRun(.startAgent)
    defer { run.finish() }
    if let computer, computer.id != project.hostId {
      throw IntentFailure.failed("\(project.name) is on \(project.computer), not \(computer.name).")
    }
    let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { throw IntentFailure.failed("Tell the agent what to do.") }
    let app = try await IntentHost.connect(project.hostId, control: true)
    let session = await app.host.startInNewWorktree(
      repoRoot: project.repoRoot, baseBranch: nil,
      request: ComposerStart(message: text, displayText: text, runnerId: runner?.id),
      defaults: AgentStartDefaults(mode: app.defaultPermissionMode?.rawValue))
    guard let session else {
      throw IntentFailure.failed("\(app.host.lastError ?? "Couldn't start the agent.")")
    }
    let entity = SessionEntity(
      id: ScopedId.make(project.hostId, session.id), name: SessionActivity.title(session),
      project: project.name, branch: session.branch)
    run.success = true
    return .result(value: entity, dialog: "Started an agent on \(project.name).")
  }
}

struct SendMessageIntent: AppIntent {
  static let title: LocalizedStringResource = "Send Message to Agent"
  static let description = IntentDescription("Sends a message to a running agent. Mid-turn, it waits in the agent's queue.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Agent", requestValueDialog: "Which agent?")
  var agent: AgentEntity

  @Parameter(title: "Message", inputOptions: .init(multiline: true), requestValueDialog: "What should I tell it?")
  var message: String

  static var parameterSummary: some ParameterSummary { Summary("Tell \(\.$agent) \(\.$message)") }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let run = IntentRun(.sendMessage)
    defer { run.finish() }
    let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { throw IntentFailure.failed("There's nothing to send.") }
    let app = try await IntentHost.connect(agent.hostId, control: true)
    let failedBefore = app.host.failedByAgent[agent.agentId]?.count ?? 0
    await app.host.sendMessage(agentId: agent.agentId, message: text)
    guard (app.host.failedByAgent[agent.agentId]?.count ?? 0) == failedBefore else {
      throw IntentFailure.failed("The message to \(agent.name) didn't go through.")
    }
    run.success = true
    return .result(dialog: "Sent to \(agent.name).")
  }
}

enum ApprovalDecision: String, AppEnum {
  case approve, deny

  static let typeDisplayRepresentation: TypeDisplayRepresentation = "Decision"
  static let caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .approve: "Approve", .deny: "Deny",
  ]
}

struct ApproveRequestIntent: AppIntent {
  static let title: LocalizedStringResource = "Approve Pending Request"
  static let description = IntentDescription("Answers an agent's permission prompt. Without an agent, it answers the first one waiting.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Agent", description: "Defaults to the first agent waiting for approval.")
  var agent: AgentEntity?

  @Parameter(title: "Decision", default: .approve)
  var decision: ApprovalDecision

  static var parameterSummary: some ParameterSummary { Summary("\(\.$decision) the request from \(\.$agent)") }

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let run = IntentRun(.approveRequest)
    defer { run.finish() }
    let app = try await IntentHost.connect(agent?.hostId, control: true)
    let waiting = await LiveAgents.needingYou(app)
    let target = agent.flatMap { picked in waiting.first { $0.agentId == picked.agentId } }
      ?? (agent == nil ? waiting.first { $0.awaiting == .permission } ?? waiting.first : nil)
    guard let target else {
      return .result(dialog: "Nothing is waiting for approval.")
    }
    let name = Labels.agentName(target)
    guard let prompt = await app.host.awaitPendingPrompt(agentId: target.agentId) else {
      let what = Labels.awaitingLabel(target) ?? "needs input"
      return .result(dialog: "\(name) \(what) — open it in Argus to answer.")
    }
    let allow = decision == .approve
    try await requestConfirmation(
      result: .result(dialog: "\(allow ? "Approve" : "Deny") \(PromptSummary.text(prompt)) for \(name)?"),
      confirmationActionName: .custom(acceptLabel: allow ? "Approve" : "Deny", acceptAlternatives: [], denyLabel: "Cancel", denyAlternatives: []))
    await app.host.respond(agentId: target.agentId, toolUseId: prompt.toolUseId, decision: allow ? "allow" : "deny")
    run.success = true
    return .result(dialog: "\(allow ? "Approved" : "Denied") \(name)'s request.")
  }
}

/// A prompt in a few words: its tool, and the command or file when it names one.
enum PromptSummary {
  static func text(_ prompt: RemotePermissionRequest) -> String {
    for key in ["command", "file_path", "path", "url"] {
      if case .string(let value) = prompt.toolInput[key] {
        return "\(prompt.toolName) \(value.count > 80 ? String(value.prefix(80)) + "…" : value)"
      }
    }
    return prompt.toolName
  }
}

struct AgentsNeedingMeIntent: AppIntent {
  static let title: LocalizedStringResource = "Agents Needing Me"
  static let description = IntentDescription("Lists the agents waiting on you for an approval, an answer or a plan review.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

  @Parameter(title: "Computer", description: "Defaults to the computer Argus was last on.")
  var computer: ComputerEntity?

  static var parameterSummary: some ParameterSummary { Summary("Agents needing me on \(\.$computer)") }

  @MainActor
  func perform() async throws -> some IntentResult & ReturnsValue<[AgentEntity]> & ProvidesDialog {
    let run = IntentRun(.agentsNeedingMe)
    defer { run.finish() }
    let app = try await IntentHost.connect(computer?.id)
    guard let hostId = app.activeHostId else { throw IntentFailure.notPaired }
    let agents = await LiveAgents.needingYou(app).map { AgentEntity($0, hostId: hostId) }
    run.success = true
    return .result(value: agents, dialog: dialog(agents))
  }

  private func dialog(_ agents: [AgentEntity]) -> IntentDialog {
    switch agents.count {
    case 0: "No agents need you."
    case 1: "\(agents[0].name) needs you: \(agents[0].detail)."
    default:
      "\(agents.count) agents need you: \(agents.prefix(3).map(\.name).formatted(.list(type: .and)))\(agents.count > 3 ? " and more" : "")."
    }
  }
}
