import ArgusCore
import SwiftUI

/// The start sheet's pickers and its send, through the start the Mac's composer uses.
extension StartAgentSheet {
  var selectedRunner: RemoteRunner? {
    runner.flatMap { id in host.runners.first { $0.id == id } }
  }

  var runnerLabel: String {
    selectedRunner?.displayName ?? runner ?? "default"
  }

  /// The models a Claude Code start offers: the host's start options, else what a
  /// live agent reported, else what the runner last reported to the host.
  private var reportedModels: [RemoteModelInfo] {
    let started = sessionId.flatMap { host.startOptionsBySession[$0]?.models } ?? []
    if !started.isEmpty { return started }
    return models.isEmpty ? host.lastKnownModels(runnerId: runner) : models
  }

  /// A custom runner declares its own models; the gateway it points at would
  /// reject the ids a Claude Code handshake reported, so they never mix.
  var modelOptions: [PickerSheet<String>.Option] {
    if let declared = selectedRunner?.models, !declared.isEmpty {
      return declared.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) }
    }
    return reportedModels.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) }
  }

  var modelLabel: String {
    guard let model else { return "default" }
    return modelOptions.first { $0.value == model }?.label ?? model
  }

  /// A custom runner's models say nothing about effort, so it offers none.
  var effortLevels: [String] {
    guard selectedRunner?.models.isEmpty ?? true else { return [] }
    return ComposerEffort.levels(for: ComposerOptions.current(model, in: reportedModels))
  }

  var linkableProjects: [RemoteProject] {
    ComposerOptions.linkable(host.projects, ownRepoRoot: repoRoot)
  }

  private var branchOptions: [PickerSheet<String>.Option] {
    branches.map {
      .init(
        value: $0.name, label: $0.name,
        hint: $0.scope == .remote ? "remote" : $0.lastCommitSubject)
    }
  }

  /// The project's base candidates; a host too old to list them offers the session's branches.
  private var baseOptions: [PickerSheet<String>.Option] {
    bases.options.isEmpty ? branchOptions : bases.options.map { .init(value: $0, label: $0) }
  }

  /// The effort picker's value for "no level": the model's default.
  private static let defaultEffort = ""

  @ViewBuilder
  func picked(_ which: Picker) -> some View {
    switch which {
    case .runner:
      PickerSheet(
        title: "Runner",
        options: [.init(value: "", label: "Default", hint: "Use the computer's default")]
          + host.runners.map {
            .init(value: $0.id, label: $0.displayName, hint: $0.isCustom ? "custom" : nil)
          },
        selected: [runner ?? ""]
      ) { value in
        runner = value.isEmpty ? nil : value
        // Model ids don't carry across runners, so a switch drops the model.
        model = nil
        effort = nil
      }
    case .model:
      PickerSheet(
        title: "Model", options: modelOptions,
        selected: Set([model].compactMap { $0 })
      ) { value in
        model = value
        // Effort levels are per model.
        effort = nil
      }
    case .effort:
      PickerSheet(
        title: "Effort",
        options: ([Self.defaultEffort] + effortLevels).map {
          .init(value: $0, label: ComposerEffort.label($0 == Self.defaultEffort ? nil : $0))
        },
        selected: [effort ?? Self.defaultEffort]
      ) { effort = $0 == Self.defaultEffort ? nil : $0 }
    case .mode:
      PickerSheet(
        title: "Permission mode",
        options: RemotePermissionMode.allCases.map { .init(value: $0.rawValue, label: $0.label) },
        selected: Set([mode?.rawValue].compactMap { $0 })
      ) { value in
        mode = RemotePermissionMode(rawValue: value)
      }
    case .base:
      PickerSheet(
        title: "Base branch", options: baseOptions, selected: Set([bases.base].compactMap { $0 }),
        emptyMessage: "This project reported no branches."
      ) { value in
        bases.picked = value
      }
    case .existing:
      PickerSheet(
        title: "Existing branch", options: branchOptions, selected: [existingBranch],
        emptyMessage: "This project reported no branches."
      ) { value in
        existingBranch = value
      }
    case .linked:
      PickerSheet(
        title: "Linked projects",
        options: linkableProjects.map { .init(value: $0.repoRoot, label: $0.name, hint: $0.repoRoot) },
        selected: Set(linkedProjects), multi: true,
        emptyMessage: "No other projects"
      ) { root in
        if linkedProjects.contains(root) {
          linkedProjects.removeAll { $0 == root }
        } else {
          linkedProjects.append(root)
        }
      }
    }
  }

  /// The first message as the composer builds it: linked projects in front, images alongside.
  private var request: ComposerStart {
    let display = trimmedPrompt.isEmpty && !images.isEmpty ? "(see attached images)" : trimmedPrompt
    return ComposerStart(
      message: display.isEmpty ? "" : LinkedProjects.buildPreamble(paths: linkedProjects, message: display),
      displayText: display, images: images.map(\.attachment), permissionMode: mode, model: model,
      effort: effort, runnerId: runner)
  }

  func start() {
    starting = true
    let chosen = issues.isEmpty ? workspace : .worktree
    let submission = Submission(
      workspace: chosen, hasImages: issues.isEmpty && !images.isEmpty, effortSet: issues.isEmpty && effort != nil)
    Task {
      let started: Started?
      if !issues.isEmpty {
        started = await startFromIssues()
      } else {
        switch chosen {
        case .current:
          started = await startHere()
        case .worktree, .existing:
          started = await startInNewSession(existing: chosen == .existing)
        }
      }
      starting = false
      guard let started else { return }
      onStarted(started, submission)
      dismiss()
    }
  }

  private func startFromIssues() async -> Started? {
    guard let repoRoot else { return nil }
    let sessions = await host.startFromIssues(
      issues, repoRoot: repoRoot, baseBranch: bases.base,
      prompt: trimmedPrompt, model: model, permissionMode: mode, runnerId: runner)
    return sessions.first.map { .session($0) }
  }

  private func startHere() async -> Started? {
    guard let sessionId,
      let agentId = await host.startAgent(inSession: sessionId, with: request, defaults: AgentStartDefaults()),
      let agent = host.statusByAgent[agentId]
    else { return nil }
    return .agent(agent)
  }

  private func startInNewSession(existing: Bool) async -> Started? {
    guard let repoRoot,
      let session = await host.startInNewWorktree(
        repoRoot: repoRoot, baseBranch: bases.base, existingBranch: existing ? existingBranch : nil,
        request: request, defaults: AgentStartDefaults())
    else { return nil }
    return .session(session)
  }
}
