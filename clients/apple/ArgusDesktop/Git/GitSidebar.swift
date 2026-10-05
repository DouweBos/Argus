import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's own sidebar: the sub-views, as Electron's `SourceSidebar`
/// lists them, then the project's refs.
struct GitSidebar: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let session: RemoteSession
  let view: GitRoute

  private var isProject: Bool { workspace.isProjectRoot }

  var body: some View {
    List(selection: selection) {
      Section(isProject ? "Workspace" : "Session") {
        row("Working Copy", "pencil.and.list.clipboard", .working, count: workspace.workingCopy.changedCount)
        if isProject {
          row("History", "clock", .history)
        } else {
          row("Branch", "arrow.triangle.branch", .branch)
        }
        row("Stashes", "tray.full", .stashes, count: workspace.stashes.stashes.count)
        if isProject {
          row("Pull Requests", "arrow.triangle.pull", .pullRequests)
          row("Branches Review", "checklist", .branchesReview)
        }
        row("Reflog", "clock.arrow.circlepath", .reflog)
        row("Blame", "person.text.rectangle", .blame(path: nil, ref: nil))
        if isProject {
          row("Bisect", "scope", .bisect)
          row("Hooks", "link", .hooks)
          row("Settings", "gearshape", .settings)
        }
        if view == .conflicts || workspace.workingCopy.isInOperation || !workspace.workingCopy.conflictedFiles.isEmpty {
          row("Conflicts", "exclamationmark.triangle", .conflicts, count: workspace.workingCopy.conflictedFiles.count)
        }
      }
      if isProject {
        GitRefSections(workspace: workspace, session: session, view: view)
      }
    }
    .listStyle(.sidebar)
  }

  private func row(_ title: String, _ symbol: String, _ route: GitRoute, count: Int = 0) -> some View {
    SidebarLabel(title, systemImage: symbol)
      .badge(count)
      .tag(GitSidebarTag.view(route.segment))
  }

  /// Rows select by segment, so `blame?path=…` still highlights Blame.
  private var selection: Binding<GitSidebarTag?> {
    Binding(
      get: {
        switch view {
        case .branches(let name?): .branch(name)
        case .tags(let name): .tag(name)
        default: .view(view.segment)
        }
      },
      set: { tag in
        let route: GitRoute? =
          switch tag {
          case .view(let segment): Self.route(segment)
          case .branch(let name): .branches(name)
          case .tag(let name): .tags(name)
          case nil: nil
          }
        if let route { model.navigate(.sessionGit(id: session.id, view: route)) }
      })
  }

  private static func route(_ segment: String) -> GitRoute? {
    segment == "blame" ? .blame(path: nil, ref: nil) : GitRoute(devString: segment)
  }
}

/// What a git sidebar row selects: a sub-view, or a branch's or tag's history.
enum GitSidebarTag: Hashable {
  case view(String)
  case branch(String)
  case tag(String)
}
