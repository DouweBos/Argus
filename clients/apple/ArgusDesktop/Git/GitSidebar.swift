import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's own sidebar, as Grove's: a summary of the repository, then
/// its refs. The views themselves are in the pill bar above the content.
struct GitSidebar: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let session: RemoteSession
  let view: GitRoute

  var body: some View {
    List(selection: selection) {
      Section {
        GitRepositoryHeader(workspace: workspace, session: session)
          .listRowSeparator(.hidden)
          .selectionDisabled()
      }
      if workspace.isProjectRoot {
        GitRefSections(workspace: workspace, session: session, view: view)
      }
    }
    .listStyle(.sidebar)
  }

  /// Branch and tag rows select their history; submodule rows the submodules view.
  private var selection: Binding<GitSidebarTag?> {
    Binding(
      get: {
        switch view {
        case .branches(let name?): .branch(name)
        case .tags(let name): .tag(name)
        case .submodules: .view(view.segment)
        default: nil
        }
      },
      set: { tag in
        let route: GitRoute? =
          switch tag {
          case .view(let segment): GitRoute(devString: segment)
          case .branch(let name): .branches(name)
          case .tag(let name): .tags(name)
          case nil: nil
          }
        if let route, route != view { model.navigate(.sessionGit(id: session.id, view: route)) }
      })
  }
}

/// What a git sidebar row selects: a sub-view, or a branch's or tag's history.
enum GitSidebarTag: Hashable {
  case view(String)
  case branch(String)
  case tag(String)
}

/// Repository name, the checked-out branch against its upstream, and how it
/// stands: Grove's sidebar summary.
private struct GitRepositoryHeader: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let session: RemoteSession

  private var head: BranchInfo? { workspace.refs.localBranches.first(where: \.isHEAD) }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(URL(fileURLWithPath: session.repoRoot).lastPathComponent)
        .font(.scaled(size: 20, weight: .semibold, design: .rounded))
        .foregroundStyle(theme.text)
        .lineLimit(1)
        .truncationMode(.middle)
      HStack(spacing: 4) {
        Image(systemName: head == nil ? "exclamationmark.triangle" : "arrow.triangle.branch")
          .font(.scaled(size: 11, weight: .semibold))
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
      .foregroundStyle(theme.textSecondary)
      .help(head?.upstreamShortName.map { "\(head?.name ?? "") tracks \($0)" } ?? "")
      FlowRow(spacing: 4, rowSpacing: 4) { badges }
    }
    .padding(.vertical, 6)
  }

  /// Without an upstream there's nothing to compare against, so "up to date" would be a guess.
  @ViewBuilder
  private var badges: some View {
    let changes = workspace.workingCopy.changedCount
    let ahead = head?.ahead ?? 0
    let behind = head?.behind ?? 0
    let unpublished = head != nil && head?.upstream == nil
    if changes == 0 && ahead == 0 && behind == 0 && !unpublished {
      Chip(label: "Up to date", icon: "checkmark.circle.fill", tone: .success)
    } else {
      if changes > 0 { Chip(label: "\(changes) changed", icon: "pencil", tone: .warning) }
      if unpublished { Chip(label: "Not published", icon: "icloud.slash") }
      if ahead > 0 { Chip(label: "\(ahead) to push", icon: "arrow.up") }
      if behind > 0 { Chip(label: "\(behind) to pull", icon: "arrow.down", tone: .warning) }
    }
  }
}
