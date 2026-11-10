#if os(iOS)
  import ArgusCore
  import ArgusKit
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
    /// Set by a caller that closes once started: the computer waits out a new worktree's setup.
    let hostWaits: Bool
    let onAffordance: ((ChatInputAffordance) -> Void)?
    let onStarted: (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void

    public init(
      repoRoot: String?,
      sessionId: String?,
      workspace: StartWorkspace.Kind = .current,
      defaultMode: RemotePermissionMode? = nil,
      issues: [HostStore.LinearIssue] = [],
      picksProject: Bool = false,
      hostWaits: Bool = false,
      onAffordance: ((ChatInputAffordance) -> Void)? = nil,
      onStarted: @escaping (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void
    ) {
      self.repoRoot = repoRoot
      self.sessionId = sessionId
      self.workspace = workspace
      self.defaultMode = defaultMode
      self.issues = issues
      self.picksProject = picksProject
      self.hostWaits = hostWaits
      self.onAffordance = onAffordance
      self.onStarted = onStarted
    }

    public var body: some View {
      StartComposerContent(
        host: host, repoRoot: repoRoot, sessionId: sessionId, workspace: workspace, defaultMode: defaultMode,
        issues: issues, picksProject: picksProject, hostWaits: hostWaits, onAffordance: onAffordance,
        onStarted: onStarted)
    }
  }

  extension AgentStartPane {
    /// Opens the pane on this draft, as if it had been typed and attached: how a share arrives.
    public static func seedDraft(
      text: String, images: [RemoteImageAttachment], repoRoot: String?, sessionId: String?,
      preferences: Preferences = Preferences(), attachments: DraftAttachments = DraftAttachments()
    ) {
      let key = StartComposerContent.draftKey(repoRoot: repoRoot, sessionId: sessionId, issues: [])
      preferences.set(text.isEmpty ? nil : text, for: PreferenceKey.draft(agentId: key))
      attachments.save(images, agentId: key)
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
      defaultMode: RemotePermissionMode?, issues: [HostStore.LinearIssue], picksProject: Bool, hostWaits: Bool,
      onAffordance: ((ChatInputAffordance) -> Void)?,
      onStarted: @escaping (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void
    ) {
      let flow = PhoneAgentStart(
        host: host, repoRoot: repoRoot, sessionId: sessionId, workspace: workspace,
        defaults: AgentStartDefaults(mode: defaultMode?.rawValue), issues: issues,
        picksProject: picksProject && sessionId == nil, hostWaits: hostWaits, onStarted: onStarted)
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
    fileprivate static func draftKey(repoRoot: String?, sessionId: String?, issues: [HostStore.LinearIssue]) -> String {
      if let issue = issues.first { return "start:issue:\(issue.id)" }
      if let sessionId { return ComposerStarter.draftKey(sessionId: sessionId) }
      return "start:repo:\(repoRoot ?? "")"
    }

    var body: some View {
      // Title and composer centred together, as on the Mac.
      VStack(spacing: 18) {
        Spacer(minLength: 0)
        title.padding(.horizontal, theme.space * 2)
        PhoneChatInputView(composer: composer, controller: controller)
        Spacer(minLength: 0)
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
          AgentStartHeading { projectName(project) }
        } else {
          AgentStartHeading()
          if flow.picksProject {
            projectMenu { Text("Pick a project").font(.scaled(.subheadline)).foregroundStyle(theme.accent) }
          } else if let session = flow.sessionId.flatMap(host.session(id:)) {
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

    /// The project a menu to start in another, as the Mac's title, when this start may pick one.
    @ViewBuilder
    private func projectName(_ project: RemoteProject) -> some View {
      let name = Text(project.name).truncationMode(.middle)
      if flow.picksProject, host.projects.count > 1 {
        projectMenu { name.underline(pattern: .dot, color: theme.textMuted) }
      } else {
        name
      }
    }

    private func projectMenu(@ViewBuilder label: () -> some View) -> some View {
      Menu {
        Picker("Project", selection: Binding(get: { flow.repoRoot ?? "" }, set: { if !$0.isEmpty { flow.pickProject($0) } })) {
          ForEach(host.projects, id: \.repoRoot) { Text($0.name).tag($0.repoRoot) }
        }
        .pickerStyle(.inline)
      } label: {
        label()
      }
      .menuIndicator(.hidden)
      .foregroundStyle(theme.text)
      .accessibilityLabel("Project: \(project?.name ?? "none")")
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
