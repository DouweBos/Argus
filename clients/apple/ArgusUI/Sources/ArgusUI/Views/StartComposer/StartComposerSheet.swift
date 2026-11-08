#if os(iOS)
  import ArgusCore
  import SwiftUI

  /// Start an agent the way the Mac does: a new agent's empty screen, its
  /// composer in start mode. The composer's chips pick model, effort, mode and
  /// links; the strip under it picks where the agent works and what it starts on.
  ///
  /// For a new worktree the computer names the branch from the prompt and starts
  /// the agent once setup finishes, so the phone can go to sleep in the meantime.
  public struct StartComposerSheet: View {
    /// What a start produced, for the caller to navigate to.
    public enum Started {
      case agent(RemoteAgentStatus)
      case session(RemoteSession)
    }

    /// What was sent, for the caller's telemetry.
    public struct Submission {
      public let workspace: StartWorkspace.Kind
      public let hasImages: Bool
      public let effortSet: Bool
      /// Started in another project than the composer opened on.
      public let changedProject: Bool
    }

    @Environment(HostStore.self) private var host

    let repoRoot: String?
    let sessionId: String?
    let workspace: StartWorkspace.Kind
    let defaultMode: RemotePermissionMode?
    let issues: [HostStore.LinearIssue]
    /// Offers a project chip; only for a start that no project has opened yet.
    let picksProject: Bool
    let onAffordance: ((ChatInputAffordance) -> Void)?
    let onStarted: (Started, Submission) -> Void

    public init(
      repoRoot: String?,
      sessionId: String?,
      workspace: StartWorkspace.Kind = .current,
      defaultMode: RemotePermissionMode? = nil,
      issues: [HostStore.LinearIssue] = [],
      picksProject: Bool = false,
      onAffordance: ((ChatInputAffordance) -> Void)? = nil,
      onStarted: @escaping (Started, Submission) -> Void
    ) {
      self.repoRoot = repoRoot
      self.sessionId = sessionId
      self.workspace = workspace
      self.defaultMode = defaultMode
      self.issues = issues
      self.picksProject = picksProject
      self.onAffordance = onAffordance
      self.onStarted = onStarted
    }

    @Environment(\.dismiss) private var dismiss

    public var body: some View {
      NavigationStack {
        AgentStartPane(
          repoRoot: repoRoot, sessionId: sessionId, workspace: workspace, defaultMode: defaultMode, issues: issues,
          picksProject: picksProject, onAffordance: onAffordance
        ) { started, sent in
          onStarted(started, sent)
          dismiss()
        }
        .navigationTitle("New Agent")
        .inlineNavigationTitle()
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }
          }
        }
      }
      .presentationDetents([.large])
    }
  }

  /// The start composer as a screen's content, the phone's `SessionStartPane`: an
  /// empty session or project shows it in place, a new session pushes it.
  public struct AgentStartPane: View {
    @Environment(HostStore.self) private var host

    let repoRoot: String?
    let sessionId: String?
    let workspace: StartWorkspace.Kind
    let defaultMode: RemotePermissionMode?
    let issues: [HostStore.LinearIssue]
    let picksProject: Bool
    let onAffordance: ((ChatInputAffordance) -> Void)?
    let onStarted: (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void

    public init(
      repoRoot: String?,
      sessionId: String?,
      workspace: StartWorkspace.Kind = .current,
      defaultMode: RemotePermissionMode? = nil,
      issues: [HostStore.LinearIssue] = [],
      picksProject: Bool = false,
      onAffordance: ((ChatInputAffordance) -> Void)? = nil,
      onStarted: @escaping (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void
    ) {
      self.repoRoot = repoRoot
      self.sessionId = sessionId
      self.workspace = workspace
      self.defaultMode = defaultMode
      self.issues = issues
      self.picksProject = picksProject
      self.onAffordance = onAffordance
      self.onStarted = onStarted
    }

    public var body: some View {
      StartComposerContent(
        host: host, repoRoot: repoRoot, sessionId: sessionId, workspace: workspace, defaultMode: defaultMode,
        issues: issues, picksProject: picksProject, onAffordance: onAffordance, onStarted: onStarted)
    }
  }

  private struct StartComposerContent: View {
    @Environment(\.theme) private var theme
    @Environment(HostStore.self) private var host

    @State private var flow: PhoneAgentStart
    @State private var composer: ComposerModel
    @State private var controller: PastingTextController
    /// This screen's viewing hint, and the session it covered.
    @State private var viewingToken: Int?
    @State private var coveredSession: String?
    private let defaultMode: String

    init(
      host: HostStore, repoRoot: String?, sessionId: String?, workspace: StartWorkspace.Kind,
      defaultMode: RemotePermissionMode?, issues: [HostStore.LinearIssue], picksProject: Bool,
      onAffordance: ((ChatInputAffordance) -> Void)?,
      onStarted: @escaping (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void
    ) {
      let flow = PhoneAgentStart(
        host: host, repoRoot: repoRoot, sessionId: sessionId, workspace: workspace,
        defaults: AgentStartDefaults(mode: defaultMode?.rawValue), issues: issues,
        picksProject: picksProject && sessionId == nil, onStarted: onStarted)
      let mode = (defaultMode ?? .auto).rawValue
      let starter = ComposerStarter(defaultMode: mode) { [weak flow] in await flow?.start($0) ?? false }
      let controller = PastingTextController()
      let composer = ComposerModel(
        agentId: Self.draftKey(repoRoot: repoRoot, sessionId: sessionId, issues: issues), sessionId: sessionId,
        host: host, starter: starter, style: .phone, editor: controller)
      composer.onAffordance = onAffordance
      composer.offersImagesAndEffort = issues.isEmpty
      self.defaultMode = mode
      _flow = State(initialValue: flow)
      _controller = State(initialValue: controller)
      _composer = State(initialValue: composer)
    }

    /// The Mac's key for a session's start composer, so a draft survives closing this.
    private static func draftKey(repoRoot: String?, sessionId: String?, issues: [HostStore.LinearIssue]) -> String {
      if let issue = issues.first { return "start:issue:\(issue.id)" }
      if let sessionId { return ComposerStarter.draftKey(sessionId: sessionId) }
      return "start:repo:\(repoRoot ?? "")"
    }

    var body: some View {
      VStack(spacing: 0) {
        Color.clear
          .frame(maxHeight: .infinity)
          .overlay { title.padding(.horizontal, theme.space * 2) }
        PhoneChatInputView(composer: composer, controller: controller)
      }
      .background(theme.bg.ignoresSafeArea())
      .environment(\.composerRedirect, flow.redirect(defaultMode: defaultMode))
      .environment(\.composerFooter, AnyView(PhoneStartFooter(flow: flow, composer: composer)))
      .task {
        await host.loadRunners()
        if let sessionId = flow.sessionId, flow.repoRoot != nil {
          flow.branches = await host.listBranches(sessionId: sessionId)
        }
      }
      .task(id: flow.repoRoot) {
        if flow.repoRoot != nil { await host.loadIntegrations() }
      }
      // Starting here takes the host's warm agent: keep one ready while this is open.
      .task(id: WarmTarget(workspace: flow.chosen, runner: composer.runner?.id)) {
        guard let sessionId = flow.sessionId else { return }
        if viewingToken == nil { coveredSession = host.viewingSessionId }
        viewingToken = await host.reportViewing(
          sessionId: flow.chosen == .current ? sessionId : coveredSession, runnerId: composer.runner?.id)
        await host.loadStartOptions(sessionId: sessionId, runnerId: composer.runner?.id)
      }
      // Only a new worktree needs a base, read again for another project.
      .task(id: BasesTarget(needed: flow.needsBases, repoRoot: flow.repoRoot)) {
        guard let repoRoot = flow.repoRoot, flow.needsBases else { return }
        await flow.workspace.loadBases(repoRoot: repoRoot, store: host)
      }
      .onChange(of: flow.issues.isEmpty) { _, none in composer.offersImagesAndEffort = none }
      .onDisappear {
        guard let viewingToken else { return }
        Task { await host.stopViewing(token: viewingToken, restoring: coveredSession) }
      }
    }

    private var project: RemoteProject? {
      flow.repoRoot.flatMap { root in host.projects.first { $0.repoRoot == root } }
    }

    @ViewBuilder
    private var title: some View {
      VStack(spacing: 6) {
        if let project {
          AgentStartHeading { Text(project.name).truncationMode(.middle) }
        } else {
          AgentStartHeading()
          if let session = flow.sessionId.flatMap(host.session(id:)) {
            Text(host.placeName(of: session)).font(.scaled(.footnote)).foregroundStyle(theme.textSecondary)
          }
        }
        if let caption {
          Text(caption)
            .font(.scaled(.footnote))
            .foregroundStyle(theme.textSecondary)
            .multilineTextAlignment(.center)
        }
      }
      .frame(maxWidth: .infinity)
    }

    private var caption: String? {
      if !flow.issues.isEmpty {
        return flow.issues.count == 1
          ? "It starts from the issue, in a worktree on Linear's branch name. Anything you add goes after it."
          : "Each starts from its issue, in a worktree on Linear's branch name. Anything you add goes after it."
      }
      return flow.chosen == .worktree ? "The computer names the branch from what you write." : nil
    }

    private struct BasesTarget: Equatable {
      let needed: Bool
      let repoRoot: String?
    }

    private struct WarmTarget: Equatable {
      let workspace: StartWorkspace.Kind
      let runner: String?
    }
  }
#endif
