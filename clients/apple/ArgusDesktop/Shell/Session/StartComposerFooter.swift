import ArgusCore
import ArgusUI
import SwiftUI

extension View {
  /// Puts the workspace strip under a start composer and, for a new worktree, sends there.
  func startWorkspace(_ workspace: StartWorkspace, session: RemoteSession?, replacing agentId: String? = nil)
    -> some View
  {
    modifier(StartWorkspaceModifier(workspace: workspace, session: session, agentId: agentId))
  }
}

private struct StartWorkspaceModifier: ViewModifier {
  @Environment(DesktopModel.self) private var model
  let workspace: StartWorkspace
  let session: RemoteSession?
  let agentId: String?

  func body(content: Content) -> some View {
    // Scratch pads and runs have no branch to stay on or fork from.
    let session = session.flatMap { $0.kind == .projectRoot || $0.kind == .worktree ? $0 : nil }
    content
      .environment(\.composerFooter, session.map { AnyView(StartComposerFooter(session: $0, workspace: workspace)) })
      .environment(
        \.composerRedirect,
        session.flatMap { session in
          workspace.kind == .worktree
            ? model.worktreeStarter(repoRoot: session.repoRoot, baseBranch: workspace.base, replacing: agentId)
            : nil
        })
  }
}

/// The strip under a start composer: where the agent works on the left; the
/// branch, and its open pull request, on the right.
struct StartComposerFooter: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let session: RemoteSession
  let workspace: StartWorkspace
  @State private var branchMenuOpen = false
  /// The checkout's local branches, read each time its branch menu opens.
  @State private var localBranches: [String]?

  private var currentLabel: String { StartWorkspace.currentLabel(for: session.kind) }

  var body: some View {
    HStack(spacing: 4) {
      workspaceMenu
      Spacer(minLength: 8)
      if workspace.kind == .current, let pr = model.sessionPullRequest(session) {
        pullRequestButton(pr)
      }
      if workspace.kind == .worktree {
        baseMenu
      } else {
        currentBranch
      }
    }
    .padding(.horizontal, 6)
    .padding(.top, 1)
    .frame(height: TextScale.shared(30))
    .background(theme.bgSecondary, in: shape)
    .overlay { shape.strokeBorder(theme.border, lineWidth: 1) }
    // Shares the composer's bottom edge rather than doubling it.
    .padding(.top, -1)
    .task(id: workspace.kind) {
      guard workspace.kind == .worktree else { return }
      await workspace.loadBases(repoRoot: session.repoRoot, store: store)
    }
    .task {
      if !model.pullRequests.loaded { await model.pullRequests.refresh() }
    }
  }

  private var shape: UnevenRoundedRectangle {
    UnevenRoundedRectangle(bottomLeadingRadius: 12, bottomTrailingRadius: 12)
  }

  private var workspaceMenu: some View {
    ChromeMenuButton(edge: .above) {
      ChromeMenuEntry.header("Workspace")
      ChromeMenuItem(
        currentLabel, subtitle: session.branch, icon: .symbol(Icon.folder), checked: workspace.kind == .current
      ) { pick(.current) }
      ChromeMenuItem(
        StartWorkspace.worktreeLabel, subtitle: StartWorkspace.worktreeHint, icon: .symbol("folder.badge.plus"),
        checked: workspace.kind == .worktree
      ) { pick(.worktree) }
    } label: { open in
      ComposerPillLabel(
        icon: workspace.kind == .worktree ? "folder.badge.plus" : Icon.folder,
        title: workspace.kind == .worktree ? StartWorkspace.worktreeLabel : currentLabel, open: open)
    }
    .buttonStyle(.argusPlain)
    .fixedSize()
    .help("Where the agent works")
  }

  private var baseMenu: some View {
    ChromeMenuButton(edge: .above) {
      ChromeMenuEntry.header("Base branch")
      if workspace.bases.options.isEmpty {
        ChromeMenuEntry.note(workspace.bases.loading ? "Loading branches…" : "No branches")
      }
      for branch in workspace.bases.options {
        ChromeMenuItem(branch, checked: branch == workspace.base) { workspace.bases.picked = branch }
      }
    } label: { open in
      ComposerPillLabel(icon: Icon.branch, title: workspace.baseTitle, open: open)
    }
    .buttonStyle(.argusPlain)
    .fixedSize()
    .help("Branch the new worktree starts from")
  }

  /// Switches the checkout in place, through the git panel's checkout so a dirty tree still asks.
  private var currentBranch: some View {
    ChromeMenuButton(isPresented: $branchMenuOpen, edge: .above) {
      ChromeMenuEntry.header("Switch branch")
      if let branches = localBranches {
        if branches.isEmpty { ChromeMenuEntry.note("No branches") }
        for branch in branches {
          ChromeMenuItem(branch, checked: branch == session.branch) { switchBranch(to: branch) }
        }
      } else {
        ChromeMenuEntry.note("Loading branches…")
      }
    } label: { open in
      ComposerPillLabel(icon: Icon.branch, title: session.branch, chevronOnHover: true, open: open)
    }
    .buttonStyle(.argusPlain)
    .fixedSize()
    .help("The branch this checkout is on")
    .task(id: branchMenuOpen) {
      guard branchMenuOpen else { return }
      localBranches = await model.localBranches(repoRoot: session.repoRoot) ?? localBranches ?? []
    }
  }

  private func switchBranch(to branch: String) {
    guard branch != session.branch else { return }
    MacTelemetry.capture(.startBranchSwitched)
    Task { await model.switchBranch(session, to: branch, theme: theme) }
  }

  private func pullRequestButton(_ pr: RemotePullRequest) -> some View {
    Button {
      model.navigate(.pullRequest(repo: pr.repo, number: pr.number))
    } label: {
      HStack(spacing: 4) {
        Image(systemName: Icon.pullRequest).font(.scaled(size: 11))
        Text("#\(pr.number)").font(.scaled(size: 12)).monospacedDigit()
      }
      .foregroundStyle(pr.isDraft ? theme.textMuted : theme.success)
      .padding(.horizontal, 7)
      .frame(height: TextScale.shared(24))
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .help("Open pull request #\(pr.number): \(pr.title)")
  }

  private func pick(_ kind: StartWorkspace.Kind) {
    guard kind != workspace.kind else { return }
    workspace.kind = kind
    MacTelemetry.capture(.startWorkspacePicked(workspace: kind.rawValue))
  }
}
