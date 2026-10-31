import ArgusCore
import ArgusUI
import SwiftUI

/// Where a new agent's first message goes: the checkout in front of you, or a
/// new worktree off a base branch, as the desktop's start composer offers.
@MainActor @Observable
final class StartWorkspace {
  enum Kind: String {
    case current, worktree
  }

  var kind: Kind = .current
  /// The base the user picked; nil keeps the preselected one.
  var picked: String?
  private(set) var options: [String] = []
  private(set) var preselected: String?
  private(set) var loading = false
  private var loaded = false
  /// The checkout's local branches, read each time its branch menu opens.
  private(set) var localBranches: [String]?

  var base: String? { picked ?? preselected }

  /// Read once, when a worktree is first asked for — the current checkout never needs them.
  func loadBranches(repoRoot: String, projectRootBranch: String?, backend: HostRouter?) async {
    guard !loaded, let backend else { return }
    loaded = true
    loading = true
    async let list = try? backend.request(ArgusProtocol.Commands.ListAllBranches.self, .init(repoRoot: repoRoot))
    async let config = try? backend.request(ArgusProtocol.Commands.ReadArgusConfig.self, .init(repoRoot: repoRoot))
    let (branches, argus) = await (list, config)
    loading = false
    guard let branches else { return }
    let protected = argus?.protectedBranches ?? []
    options = BaseBranchChoice.options(local: branches.local, originRefs: branches.originRefs, protected: protected)
    preselected = BaseBranchChoice.preselected(
      local: branches.local, originRefs: branches.originRefs,
      configured: argus?.defaultBaseBranch.flatMap { $0.isEmpty ? nil : $0 }, protected: protected,
      projectRootBranch: projectRootBranch)
  }

  func loadLocalBranches(repoRoot: String, model: DesktopModel) async {
    localBranches = await model.localBranches(repoRoot: repoRoot) ?? localBranches ?? []
  }
}

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

  private var currentLabel: String { session.kind == .projectRoot ? "Current checkout" : "This worktree" }

  private var projectRootBranch: String? {
    store.sessionsByRepo[session.repoRoot]?.first { $0.kind == .projectRoot }?.branch
  }

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
      await workspace.loadBranches(
        repoRoot: session.repoRoot, projectRootBranch: projectRootBranch, backend: model.backend)
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
        "New worktree", subtitle: "A new branch, named from the prompt", icon: .symbol("folder.badge.plus"),
        checked: workspace.kind == .worktree
      ) { pick(.worktree) }
    } label: { open in
      ComposerPillLabel(
        icon: workspace.kind == .worktree ? "folder.badge.plus" : Icon.folder,
        title: workspace.kind == .worktree ? "New worktree" : currentLabel, open: open)
    }
    .buttonStyle(.argusPlain)
    .fixedSize()
    .help("Where the agent works")
  }

  private var baseMenu: some View {
    ChromeMenuButton(edge: .above) {
      ChromeMenuEntry.header("Base branch")
      if workspace.options.isEmpty {
        ChromeMenuEntry.note(workspace.loading ? "Loading branches…" : "No branches")
      }
      for branch in workspace.options {
        ChromeMenuItem(branch, checked: branch == workspace.base) { workspace.picked = branch }
      }
    } label: { open in
      ComposerPillLabel(icon: Icon.branch, title: baseTitle, open: open)
    }
    .buttonStyle(.argusPlain)
    .fixedSize()
    .help("Branch the new worktree starts from")
  }

  private var baseTitle: String {
    if let base = workspace.base { return "from \(base)" }
    return workspace.loading ? "Loading branches…" : "Project default"
  }

  /// Switches the checkout in place, through the git panel's checkout so a dirty tree still asks.
  private var currentBranch: some View {
    ChromeMenuButton(isPresented: $branchMenuOpen, edge: .above) {
      ChromeMenuEntry.header("Switch branch")
      if let branches = workspace.localBranches {
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
      await workspace.loadLocalBranches(repoRoot: session.repoRoot, model: model)
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
