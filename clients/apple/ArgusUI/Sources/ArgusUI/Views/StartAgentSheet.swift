import ArgusCore
import SwiftUI

/// Start an agent: say what it should do, then where it works — the session in
/// front of you, a fresh worktree off a base branch, or a branch that already
/// exists — and what it starts on.
///
/// The same choice as the desktop's start composer. For a new worktree the
/// computer names the branch from the prompt and starts the agent once setup
/// finishes, so the phone can go to sleep in the meantime.
public struct StartAgentSheet: View {
  public enum Workspace: String, CaseIterable, Identifiable {
    case current, worktree, existing
    public var id: String { rawValue }
  }

  /// What a start produced, for the caller to navigate to.
  public enum Started {
    case agent(RemoteAgentStatus)
    case session(RemoteSession)
  }

  private enum Picker: String, Identifiable {
    case runner, model, mode, base, existing
    var id: String { rawValue }
  }

  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  let repoRoot: String?
  /// The session "current" means; also where the branch list is read from.
  let sessionId: String?
  /// "Current checkout" on a project's root, "This session" anywhere else.
  let currentLabel: String
  /// Models are reported per agent, so this offers whatever a live agent in
  /// this project last reported — and nothing when none has.
  let models: [RemoteModelInfo]
  let onStarted: (Started, Workspace) -> Void

  @State private var prompt = ""
  @State private var workspace: Workspace
  @State private var branches: [RemoteGitBranch] = []
  @State private var baseBranch = ""
  @State private var existingBranch = ""
  @State private var runner: String?
  @State private var model: String?
  @State private var mode: RemotePermissionMode?
  @State private var picker: Picker?
  @State private var starting = false
  /// Each gets its own worktree on Linear's branch name.
  @State private var issues: [HostStore.LinearIssue] = []
  @State private var pickingIssues = false

  public init(
    repoRoot: String?,
    sessionId: String?,
    currentLabel: String = "This session",
    workspace: Workspace = .current,
    models: [RemoteModelInfo],
    defaultMode: RemotePermissionMode? = nil,
    onStarted: @escaping (Started, Workspace) -> Void
  ) {
    self.repoRoot = repoRoot
    self.sessionId = sessionId
    self.currentLabel = currentLabel
    self.models = models
    self.onStarted = onStarted
    _workspace = State(initialValue: sessionId == nil ? .worktree : workspace)
    _mode = State(initialValue: defaultMode)
  }

  private var trimmedPrompt: String {
    prompt.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var canStart: Bool {
    guard !starting else { return false }
    if !issues.isEmpty { return repoRoot != nil }
    switch workspace {
    case .current: return sessionId != nil
    // The branch is named from the prompt, so it needs words.
    case .worktree: return repoRoot != nil && !trimmedPrompt.isEmpty
    case .existing: return repoRoot != nil && !existingBranch.isEmpty
    }
  }

  private var workspaceOptions: [(value: Workspace, label: String)] {
    var options: [(value: Workspace, label: String)] = []
    if sessionId != nil {
      options.append((.current, currentLabel))
    }
    if repoRoot != nil {
      options.append((.worktree, "New worktree"))
      options.append((.existing, "Existing branch"))
    }
    return options
  }

  public var body: some View {
    NavigationStack {
      Screen {
        Field(label: "WHAT SHOULD IT DO?", caption: promptCaption) {
          ThemedTextField(
            placeholder: issues.isEmpty ? "Fix the flaky login test" : "Anything to add (optional)",
            text: $prompt, multiline: true, lines: 3...8)
          if repoRoot != nil, host.linearConnected {
            if !issues.isEmpty { PickedIssueChips(issues: $issues) }
            Btn(label: "Add Linear issue", tone: .secondary, small: true, icon: Icon.issue) {
              pickingIssues = true
            }
          }
        }

        if !issues.isEmpty {
          Field(label: "WHERE", caption: "A new worktree per issue, on Linear's branch name.") {
            Btn(
              label: baseBranch.isEmpty ? "Base: project default" : "Base: \(baseBranch)",
              tone: .secondary, small: true
            ) { picker = .base }
          }
        } else if workspaceOptions.count > 1 {
          Field(label: "WHERE") {
            SegmentedControl(value: $workspace, options: workspaceOptions)

            switch workspace {
            case .current:
              EmptyView()
            case .worktree:
              Btn(
                label: baseBranch.isEmpty ? "Base: project default" : "Base: \(baseBranch)",
                tone: .secondary, small: true
              ) { picker = .base }
            case .existing:
              Btn(
                label: existingBranch.isEmpty ? "Pick a branch" : existingBranch,
                tone: .secondary, small: true
              ) { picker = .existing }
            }
          }
        }

        Field(label: "START IT ON", caption: "Blank uses the computer's default.") {
          if !host.runners.isEmpty {
            Btn(
              label: "Runner: \(runnerLabel)", tone: .secondary, small: true
            ) { picker = .runner }
          }
          if !modelOptions.isEmpty {
            Btn(
              label: "Model: \(modelLabel)", tone: .secondary, small: true
            ) { picker = .model }
          }
          Btn(
            label: "Permission mode: \(mode?.label ?? "default")", tone: .secondary, small: true
          ) { picker = .mode }
        }

        Btn(label: startLabel, icon: Icon.plus) { start() }
          .disabled(!canStart)
      }
      .navigationTitle("New agent")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
      .sheet(item: $picker) { which in picked(which) }
      .background {
        Color.clear.sheet(isPresented: $pickingIssues) { IssuePickerSheet(selection: $issues) }
      }
      .task {
        if repoRoot != nil { await host.loadIntegrations() }
        await host.loadRunners()
        if let sessionId, repoRoot != nil {
          branches = await host.listBranches(sessionId: sessionId)
        }
      }
    }
  }

  private var promptCaption: String? {
    if !issues.isEmpty { return "Each agent starts from its issue; this goes after it." }
    return workspace == .worktree ? "The computer names the branch from this." : nil
  }

  private var startLabel: String {
    if starting { return "Starting…" }
    return issues.count > 1 ? "Start \(issues.count) agents" : "Start agent"
  }

  private var selectedRunner: RemoteRunner? {
    runner.flatMap { id in host.runners.first { $0.id == id } }
  }

  private var runnerLabel: String {
    selectedRunner?.displayName ?? runner ?? "default"
  }

  /// A custom runner declares its own models; the gateway it points at would
  /// reject the ids a Claude Code handshake reported, so they never mix.
  private var modelOptions: [PickerSheet<String>.Option] {
    if let declared = selectedRunner?.models, !declared.isEmpty {
      return declared.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) }
    }

    return models.map { .init(value: $0.value, label: $0.displayName, hint: $0.description) }
  }

  private var modelLabel: String {
    guard let model else { return "default" }

    return modelOptions.first { $0.value == model }?.label ?? model
  }

  private var branchOptions: [PickerSheet<String>.Option] {
    branches.map {
      .init(
        value: $0.name, label: $0.name,
        hint: $0.scope == .remote ? "remote" : $0.lastCommitSubject)
    }
  }

  @ViewBuilder
  private func picked(_ which: Picker) -> some View {
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
      }
    case .model:
      PickerSheet(
        title: "Model", options: modelOptions,
        selected: Set([model].compactMap { $0 })
      ) { value in
        model = value
      }
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
        title: "Base branch", options: branchOptions, selected: [baseBranch],
        emptyMessage: "This project reported no branches."
      ) { value in
        baseBranch = value
      }
    case .existing:
      PickerSheet(
        title: "Existing branch", options: branchOptions, selected: [existingBranch],
        emptyMessage: "This project reported no branches."
      ) { value in
        existingBranch = value
      }
    }
  }

  private func start() {
    starting = true
    let chosen = issues.isEmpty ? workspace : .worktree
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
      onStarted(started, chosen)
      dismiss()
    }
  }

  private func startFromIssues() async -> Started? {
    guard let repoRoot else { return nil }
    let sessions = await host.startFromIssues(
      issues, repoRoot: repoRoot, baseBranch: baseBranch.isEmpty ? nil : baseBranch,
      prompt: trimmedPrompt, model: model, permissionMode: mode, runnerId: runner)
    return sessions.first.map { .session($0) }
  }

  private func startHere() async -> Started? {
    guard let sessionId,
      let agent = await host.spawnAgent(
        sessionId: sessionId, model: model, permissionMode: mode, runnerId: runner)
    else { return nil }
    if !trimmedPrompt.isEmpty {
      await host.sendMessage(agentId: agent.agentId, message: trimmedPrompt)
    }
    return .agent(agent)
  }

  private func startInNewSession(existing: Bool) async -> Started? {
    guard let repoRoot,
      let session = await host.createSession(
        repoRoot: repoRoot,
        branch: existing ? existingBranch : "",
        description: trimmedPrompt,
        useExistingBranch: existing ? true : nil,
        baseBranch: !existing && !baseBranch.isEmpty ? baseBranch : nil,
        prompt: trimmedPrompt.isEmpty ? nil : trimmedPrompt,
        model: model, permissionMode: mode, runnerId: runner)
    else { return nil }
    return .session(session)
  }
}
