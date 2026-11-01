#if os(iOS)
  import ArgusCore
  import Foundation
  import Observation

  /// A phone start composer's choices beyond the composer's own chips — where
  /// the agent works and which Linear issues it takes — and the start they make.
  @MainActor
  @Observable
  final class PhoneAgentStart {
    let repoRoot: String?
    /// The session "current" means; also where the branch list is read from.
    let sessionId: String?
    let openedOn: StartWorkspace.Kind
    let workspace: StartWorkspace
    /// Each gets its own worktree on Linear's branch name.
    var issues: [HostStore.LinearIssue]
    var branches: [RemoteGitBranch] = []
    /// Set once a start went through, for the screen to close.
    private(set) var finished = false

    @ObservationIgnored private weak var host: HostStore?
    @ObservationIgnored private let defaults: AgentStartDefaults
    @ObservationIgnored private let onStarted: (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void

    init(
      host: HostStore, repoRoot: String?, sessionId: String?, workspace: StartWorkspace.Kind,
      defaults: AgentStartDefaults, issues: [HostStore.LinearIssue],
      onStarted: @escaping (StartComposerSheet.Started, StartComposerSheet.Submission) -> Void
    ) {
      self.host = host
      self.repoRoot = repoRoot
      self.sessionId = sessionId
      // With no session there's no "current"; with no project, nothing else.
      let kind: StartWorkspace.Kind = sessionId == nil ? .worktree : repoRoot == nil ? .current : workspace
      self.openedOn = kind
      self.workspace = StartWorkspace(kind: kind)
      self.defaults = defaults
      self.issues = issues
      self.onStarted = onStarted
    }

    /// Issues always start in worktrees of their own.
    var chosen: StartWorkspace.Kind { issues.isEmpty ? workspace.kind : .worktree }

    var options: [StartWorkspace.Kind] {
      (sessionId != nil ? [.current] : []) + (repoRoot != nil ? [.worktree, .existing] : [])
    }

    /// A new worktree's base, and, with no session to list branches from, an existing branch's choices.
    var needsBases: Bool {
      repoRoot != nil && (chosen == .worktree || (chosen == .existing && branches.isEmpty))
    }

    /// What the composer sends through, as the footer's choice needs it.
    func redirect(defaultMode: String) -> ComposerStarter {
      let start: @MainActor (ComposerStart) async -> Bool = { [weak self] in await self?.start($0) ?? false }
      if !issues.isEmpty {
        return ComposerStarter(
          defaultMode: defaultMode, needsContent: false, ready: repoRoot != nil,
          placeholder: "Anything to add (optional)", start: start)
      }
      let placeholder = "What should it do?"
      switch workspace.kind {
      case .current:
        return ComposerStarter(
          defaultMode: defaultMode, ready: sessionId != nil, placeholder: placeholder, start: start)
      case .worktree:
        // The computer names the branch from the prompt.
        return ComposerStarter(
          defaultMode: defaultMode, needsText: true, ready: repoRoot != nil, placeholder: placeholder, start: start)
      case .existing:
        return ComposerStarter(
          defaultMode: defaultMode, ready: repoRoot != nil && workspace.existingBranch != nil,
          placeholder: placeholder, start: start)
      }
    }

    func start(_ request: ComposerStart) async -> Bool {
      guard let host else { return false }
      let kind = chosen
      let started: StartComposerSheet.Started?
      if !issues.isEmpty {
        started = await startFromIssues(request, host: host)
      } else if kind == .current {
        started = await startHere(request, host: host)
      } else {
        started = await startInNewSession(request, existing: kind == .existing, host: host)
      }
      guard let started else { return false }
      onStarted(
        started,
        .init(
          workspace: kind, hasImages: issues.isEmpty && !request.images.isEmpty,
          effortSet: issues.isEmpty && request.effort != nil))
      finished = true
      return true
    }

    private func startFromIssues(_ request: ComposerStart, host: HostStore) async -> StartComposerSheet.Started? {
      guard let repoRoot else { return nil }
      let sessions = await host.startFromIssues(
        issues, repoRoot: repoRoot, baseBranch: workspace.base, prompt: request.message, model: request.model,
        permissionMode: request.permissionMode ?? defaults.mode.flatMap(RemotePermissionMode.init(rawValue:)),
        runnerId: request.runnerId)
      return sessions.first.map { .session($0) }
    }

    private func startHere(_ request: ComposerStart, host: HostStore) async -> StartComposerSheet.Started? {
      guard let sessionId,
        let agentId = await host.startAgent(inSession: sessionId, with: request, defaults: defaults),
        let agent = host.statusByAgent[agentId]
      else { return nil }
      return .agent(agent)
    }

    private func startInNewSession(
      _ request: ComposerStart, existing: Bool, host: HostStore
    ) async -> StartComposerSheet.Started? {
      guard let repoRoot,
        let session = await host.startInNewWorktree(
          repoRoot: repoRoot, baseBranch: workspace.base, existingBranch: existing ? workspace.existingBranch : nil,
          request: request, defaults: defaults)
      else { return nil }
      return .session(session)
    }
  }
#endif
