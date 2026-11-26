import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// The git panel's own sidebar: a summary of the repository, then GroveUIKit's refs. Flat on the canvas like the
/// code navigator, so it stays below the toolbar rather than drawing a source-list material up under it.
/// A worktree session lists its refs too; what it can't run there is off, with the reason.
struct GitSidebar: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let session: RemoteSession
  let view: GitRoute

  var body: some View {
    let actions = RefActions(workspace: workspace, session: session, model: model)
    // The header stays put so the list starts below it: a list touching the
    // window's top scrolls up under the transparent toolbar.
    VStack(spacing: 0) {
      GitRepositoryHeader(workspace: workspace, session: session)
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
      Rectangle().fill(theme.border).frame(height: 1)
      CrossProjectGitSection(session: session, view: view)
      GitRefsSidebar(
        model: workspace.refsModel, dialogs: actions.dialogContext, presenter: model.gitDialogs,
        selection: Binding(get: { selection }, set: select), host: host(actions)
      )
      .scrollContentBackground(.hidden)
      .gitFeatures(workspace.features)
      .gitUIHost(.argus(openLine: nil))
    }
    .task(id: workspace.generation) {
      await actions.marks.load(repoRoot: session.repoRoot, backend: model.store.backend)
    }
    .onChange(of: workspace.refsModel.filter) { old, new in
      if new.isEmpty, !old.isEmpty { reportFilter(old) }
    }
    .onDisappear {
      if !workspace.refsModel.filter.isEmpty { reportFilter(workspace.refsModel.filter) }
    }
  }

  /// Whether a filtering found anything, never what was typed.
  private func reportFilter(_ query: String) {
    let query = query.trimmingCharacters(in: .whitespaces)
    let refs = workspace.refs
    let names =
      refs.localBranches.map(\.name) + refs.remoteBranches.map(\.name) + refs.tags.map(\.name)
      + refs.worktrees.compactMap(\.branch) + refs.submodules.map(\.path)
    MacTelemetry.capture(.gitSidebarFiltered(matched: names.contains { $0.localizedStandardContains(query) }))
  }

  /// Branch and tag rows show their history; a submodule the submodules view.
  private var selection: GitRefItem? {
    switch view {
    case .branches(let name?):
      workspace.refs.localBranches.contains { $0.name == name } ? .branch(name) : .remoteBranch(name)
    case .tags(let name): .tag(name)
    default: nil
    }
  }

  private func select(_ item: GitRefItem?) {
    let route: GitRoute? =
      switch item {
      case .branch(let name), .remoteBranch(let name): .branches(name)
      case .tag(let name): .tags(name)
      case .submodule: .submodules
      default: nil
      }
    guard let route, route != view else { return }
    model.navigate(.sessionGit(id: session.id, view: route))
  }

  /// Pins and archives on the host, protected branches and the base from `.argus.json`, and routes for the rest.
  private func host(_ actions: RefActions) -> GitRefsHost {
    let marks = actions.marks
    var host = GitRefsHost()
    host.marks = GitBranchMarks(
      pinned: Set(marks.pinned), archived: Set(marks.archived), protected: Set(marks.protected),
      base: marks.defaultBase ?? session.baseBranch)
    host.setPinned = { name, pinned in Task { await actions.setPinned(name, pinned) } }
    host.setArchived = { name, archived in Task { await actions.setArchived(name, archived) } }
    // The banner shows what failed, with its fixes.
    host.showsFailures = false
    host.compare = { base, compare in actions.compare(base, with: compare) }
    host.createPullRequest = { _ in actions.createPullRequest() }
    host.revealInHistory = { [model, workspace, session] sha, _ in
      model.navigate(.sessionGit(id: session.id, view: .history))
      Task { await workspace.history.reveal(sha) }
    }
    return host
  }
}

/// Repository name, the checked-out branch against its upstream, and how it stands.
private struct GitRepositoryHeader: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let session: RemoteSession

  private var head: BranchInfo? { workspace.refs.localBranches.first(where: \.isHEAD) }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(URL(fileURLWithPath: session.repoRoot).lastPathComponent)
        .font(.scaled(size: 14, weight: .semibold))
        .foregroundStyle(theme.text)
        .lineLimit(1)
        .truncationMode(.middle)
      HStack(spacing: 4) {
        Image(systemName: head == nil ? "exclamationmark.triangle" : "arrow.triangle.branch")
          .font(.scaled(size: 10))
        Text(head?.name ?? "Detached HEAD")
          .lineLimit(1)
          .truncationMode(.middle)
        if let upstream = head?.upstreamShortName {
          Text("\u{2192} \(upstream)")
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }
      .font(.scaled(size: 11, design: .monospaced))
      .foregroundStyle(theme.textMuted)
      .help(head?.upstreamShortName.map { "\(head?.name ?? "") tracks \($0)" } ?? "")
      HStack(spacing: 10) { status }
        .labelStyle(GitStatusLabelStyle())
        .font(.scaled(size: 11).monospacedDigit())
        .foregroundStyle(theme.textSecondary)
        .lineLimit(1)
        .padding(.top, 2)
    }
    .padding(.vertical, 6)
    .padding(.horizontal, 2)
  }

  /// Without an upstream there's nothing to compare against, so "up to date" would be a guess.
  @ViewBuilder
  private var status: some View {
    let changes = workspace.workingCopy.changedCount
    let ahead = head?.ahead ?? 0
    let behind = head?.behind ?? 0
    let unpublished = head != nil && head?.upstream == nil
    if changes == 0 && ahead == 0 && behind == 0 && !unpublished {
      Label("Up to date", systemImage: "checkmark").foregroundStyle(theme.textMuted)
    } else {
      if changes > 0 { Label("\(changes) changed", systemImage: "pencil") }
      if unpublished { Label("Not published", systemImage: "icloud.slash") }
      if ahead > 0 { Label("\(ahead)", systemImage: "arrow.up").help("\(ahead) commits to push") }
      if behind > 0 { Label("\(behind)", systemImage: "arrow.down").help("\(behind) commits to pull") }
    }
  }
}

/// Icon and text tight together, so the status fits one line in a narrow column.
private struct GitStatusLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 3) {
      configuration.icon.font(.scaled(size: 9, weight: .semibold))
      configuration.title
    }
  }
}
