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
        } else {
          ContentUnavailableView(
            "Pick a session", systemImage: "sidebar.left",
            description: Text("Choose a session in the sidebar, or create one."))
        }
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

/// Peacock's tokens for the system appearance, in any window.
private struct Themed: ViewModifier {
  @Environment(\.colorScheme) private var colorScheme

  func body(content: Content) -> some View {
    content
      .environment(\.theme, colorScheme == .dark ? .dark : .light)
      .tint(colorScheme == .dark ? Theme.dark.accent : Theme.light.accent)
  }
}

extension View {
  func themed() -> some View { modifier(Themed()) }
}
