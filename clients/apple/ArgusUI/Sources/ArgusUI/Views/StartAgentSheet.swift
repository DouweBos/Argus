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

  /// What was sent, for the caller's telemetry.
  public struct Submission {
    public let workspace: Workspace
    public let hasImages: Bool
    public let effortSet: Bool
  }

  enum Picker: String, Identifiable {
    case runner, model, effort, mode, base, existing, linked
    var id: String { rawValue }
  }

  @Environment(HostStore.self) var host
  @Environment(\.dismiss) var dismiss

  let repoRoot: String?
  /// The session "current" means; also where the branch list is read from.
  let sessionId: String?
  /// "Current checkout" on a project's root, "This session" anywhere else.
  let currentLabel: String
  /// What a live agent in this project last reported; the host's start
  /// options for the session replace it once they arrive.
  let models: [RemoteModelInfo]
  let onStarted: (Started, Submission) -> Void

  @State var prompt = ""
  @State var workspace: Workspace
  @State var branches: [RemoteGitBranch] = []
  /// A new worktree's base, preselected as the Mac does.
  @State var bases = BaseBranchPicker()
  @State var existingBranch = ""
  @State var runner: String?
  @State var model: String?
  @State var effort: String?
  @State var mode: RemotePermissionMode?
  @State var images: [PendingImage] = []
  @State var linkedProjects: [String] = []
  @State var picker: Picker?
  @State private var showingAttachMenu = false
  @State var starting = false
  /// Each gets its own worktree on Linear's branch name.
  @State var issues: [HostStore.LinearIssue] = []
  @State private var pickingIssues = false
  /// This sheet's viewing hint, and the session it covered.
  @State private var viewingToken: Int?
  @State private var coveredSession: String?

  public init(
    repoRoot: String?,
    sessionId: String?,
    currentLabel: String = "This session",
    workspace: Workspace = .current,
    models: [RemoteModelInfo],
    defaultMode: RemotePermissionMode? = nil,
    issues: [HostStore.LinearIssue] = [],
    onStarted: @escaping (Started, Submission) -> Void
  ) {
    self.repoRoot = repoRoot
    self.sessionId = sessionId
    self.currentLabel = currentLabel
    self.models = models
    self.onStarted = onStarted
    _workspace = State(initialValue: sessionId == nil ? .worktree : workspace)
    _mode = State(initialValue: defaultMode)
    _issues = State(initialValue: issues)
  }

  var trimmedPrompt: String {
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
        Field(label: "What should it do?", caption: promptCaption) {
          ThemedTextField(
            placeholder: issues.isEmpty ? "Fix the flaky login test" : "Anything to add (optional)",
            text: $prompt, multiline: true, lines: 3...8)
          if issues.isEmpty {
            #if os(iOS)
              if !images.isEmpty {
                PendingImageStrip(images: images) { id in images.removeAll { $0.id == id } }
              }
            #endif
            attachButtons
          }
          if repoRoot != nil, host.linearConnected {
            if !issues.isEmpty { PickedIssueChips(issues: $issues) }
            Btn(label: "Add Linear issue", tone: .secondary, small: true, icon: Icon.issue) {
              pickingIssues = true
            }
          }
        }

        if !issues.isEmpty {
          Field(label: "Where", caption: "A new worktree per issue, on Linear's branch name.") {
            Btn(label: baseLabel, tone: .secondary, small: true) { picker = .base }
          }
        } else if workspaceOptions.count > 1 {
          Field(label: "Where") {
            SegmentedControl(value: $workspace, options: workspaceOptions)

            switch workspace {
            case .current:
              EmptyView()
            case .worktree:
              Btn(label: baseLabel, tone: .secondary, small: true) { picker = .base }
            case .existing:
              Btn(
                label: existingBranch.isEmpty ? "Pick a branch" : existingBranch,
                tone: .secondary, small: true
              ) { picker = .existing }
            }
          }
        }

        Field(label: "Start it on", caption: "Blank uses the computer's default.") {
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
          if issues.isEmpty, !effortLevels.isEmpty {
            Btn(
              label: "Effort: \(ComposerEffort.label(effort))", tone: .secondary, small: true
            ) { picker = .effort }
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
      #if os(iOS)
        .phoneImageAttach(isPresented: $showingAttachMenu) { images += $0 }
      #endif
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
      // Starting here takes the host's warm agent: keep one ready while this is open.
      .task(id: warmTarget) {
        guard let sessionId else { return }
        if viewingToken == nil { coveredSession = host.viewingSessionId }
        viewingToken = await host.reportViewing(
          sessionId: workspace == .current ? sessionId : coveredSession, runnerId: runner)
        await host.loadStartOptions(sessionId: sessionId, runnerId: runner)
      }
      // Only a new worktree needs a base.
      .task(id: workspace == .worktree || !issues.isEmpty) {
        guard let repoRoot, workspace == .worktree || !issues.isEmpty else { return }
        await bases.load(repoRoot: repoRoot, projectRootBranch: projectRootBranch, store: host)
      }
      .onDisappear {
        guard let viewingToken else { return }
        Task { await host.stopViewing(token: viewingToken, restoring: coveredSession) }
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

  @ViewBuilder
  private var attachButtons: some View {
    #if os(iOS)
      Btn(label: "Attach image", tone: .secondary, small: true, icon: Icon.image) { showingAttachMenu = true }
    #endif
    if !linkableProjects.isEmpty {
      Btn(
        label: linkedProjects.isEmpty ? "Link project" : "\(linkedProjects.count) linked",
        tone: .secondary, small: true, icon: Icon.link
      ) { picker = .linked }
    }
  }

  private var baseLabel: String {
    if let base = bases.base { return "Base: \(base)" }
    return bases.loading ? "Base: loading…" : "Base: project default"
  }

  private var projectRootBranch: String? {
    repoRoot.flatMap { host.sessionsByRepo[$0]?.first { $0.kind == .projectRoot }?.branch }
  }

  private struct WarmTarget: Equatable {
    let workspace: Workspace
    let runner: String?
  }

  private var warmTarget: WarmTarget { WarmTarget(workspace: workspace, runner: runner) }
}
