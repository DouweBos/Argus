import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's own sidebar: a summary of the repository, then its refs.
/// Flat on the canvas like the code navigator, so it stays below the toolbar
/// rather than drawing a source-list material up under it.
struct GitSidebar: View {
  let workspace: GitWorkspace
  let session: RemoteSession
  let view: GitRoute

  var body: some View {
    List {
      GitRepositoryHeader(workspace: workspace, session: session)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
      if workspace.isProjectRoot {
        GitRefSections(workspace: workspace, session: session, view: view)
          .listRowSeparator(.hidden)
          .listSectionSeparator(.hidden)
      }
    }
    .navigatorList()
    .environment(\.gitSidebarContext, GitSidebarContext(sessionId: session.id, view: view))
  }
}

/// Which session's git view the sidebar rows select into, and what's showing.
struct GitSidebarContext: Equatable {
  let sessionId: String
  let view: GitRoute

  /// Branch and tag rows select their history; submodule rows the submodules view.
  var selected: GitSidebarTag? {
    switch view {
    case .branches(let name?): .branch(name)
    case .tags(let name): .tag(name)
    case .submodules: .view(view.segment)
    default: nil
    }
  }

  func route(for tag: GitSidebarTag) -> GitRoute? {
    switch tag {
    case .view(let segment): GitRoute(devString: segment)
    case .branch(let name): .branches(name)
    case .tag(let name): .tags(name)
    }
  }
}

extension EnvironmentValues {
  @Entry var gitSidebarContext: GitSidebarContext?
}

/// A git sidebar row that selects `tag` on click, with the navigator's quiet highlight.
private struct GitSidebarRow: ViewModifier {
  @Environment(DesktopModel.self) private var model
  @Environment(\.gitSidebarContext) private var context
  let tag: GitSidebarTag

  private var selected: Bool { context?.selected == tag }

  func body(content: Content) -> some View {
    content
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(.rect)
      .onTapGesture(perform: select)
      .modifier(NavigatorRowHighlight(selected: selected))
      .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
      .accessibilityAction { select() }
  }

  private func select() {
    guard let context, let route = context.route(for: tag), route != context.view else { return }
    model.navigate(.sessionGit(id: context.sessionId, view: route))
  }
}

extension View {
  func gitSidebarRow(_ tag: GitSidebarTag) -> some View {
    modifier(GitSidebarRow(tag: tag))
  }
}

/// What a git sidebar row selects: a sub-view, or a branch's or tag's history.
enum GitSidebarTag: Hashable {
  case view(String)
  case branch(String)
  case tag(String)
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
