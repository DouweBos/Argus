import ArgusUI
import SwiftUI

/// The three panels: workspace sidebar, agent control, runtime.
struct MainWindow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var imageViewer = ImageViewerState()

  var body: some View {
    NavigationSplitView {
      SidebarView()
        .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 360)
    } content: {
      VStack(spacing: 0) {
        HuddleJoinRequests()
        Group {
        if let sessionId = model.route.sessionId {
          SessionView(sessionId: sessionId)
        } else if model.route == .agents {
          AgentsOverview()
        } else if model.route == .runtimes {
          RuntimesOverview()
        } else if model.route == .devices {
          DevicesScreen()
        } else if model.route == .pullRequests {
          PullRequestsScreen()
        } else if case .pullRequest(let repo, let number) = model.route {
          PullRequestDetailScreen(repo: repo, number: number)
            .id("\(repo)#\(number)")
        } else if RouteScreen.handles(model.route) {
          RouteScreen(route: model.route)
        } else {
          HomeScreen()
        }
        }
        .frame(maxHeight: .infinity)
      }
      .navigationSplitViewColumnWidth(min: 420, ideal: 640)
    } detail: {
      RuntimePanel(sessionId: model.route.sessionId)
        .navigationSplitViewColumnWidth(min: 280, ideal: 420)
    }
    // One image viewer for the window, as on the phone.
    .overlay {
      ImageViewerOverlay()
        .onExitCommand { imageViewer.dismiss() }
    }
    .overlay(alignment: .top) {
      if model.palette.isPresented {
        CommandPaletteView().padding(.top, 60)
      }
    }
    .modifier(ProjectFlows())
    .modifier(HandoffActivity())
    .sheet(item: projectSettingsRepo) { repo in
      ProjectSettingsSheet(repoRoot: repo.path)
    }
    .environment(imageViewer)
    // The viewer covers the window; the toolbar would still draw over it.
    .toolbar(imageViewer.isPresented ? .hidden : .automatic, for: .windowToolbar)
    .themed()
    // A project added while we're up arrives as `projects.changed` alone.
    .task(id: store.projects.map(\.repoRoot)) {
      for project in store.projects where store.sessionsByRepo[project.repoRoot] == nil {
        await model.openProject(project.repoRoot)
      }
    }
  }
}

extension MainWindow {
  private var projectSettingsRepo: Binding<RepoPath?> {
    Binding(
      get: { model.projectSettingsRepo.map(RepoPath.init) },
      set: { model.projectSettingsRepo = $0?.path })
  }
}

/// A repo root as a sheet item.
struct RepoPath: Identifiable {
  let path: String
  var id: String { path }
}

/// Peacock's tokens for the system appearance, in any window, at the
/// display size picked in Settings.
private struct Themed: ViewModifier {
  @Environment(\.colorScheme) private var colorScheme

  func body(content: Content) -> some View {
    let prefs = AppPreferences.shared
    content
      .environment(\.theme, colorScheme == .dark ? .dark : .light)
      .tint(colorScheme == .dark ? Theme.dark.accent : Theme.light.accent)
      .dynamicTypeSize(prefs.dynamicTypeSize)
      .controlSize(prefs.controlSize)
  }
}

extension View {
  func themed() -> some View { modifier(Themed()) }
}
