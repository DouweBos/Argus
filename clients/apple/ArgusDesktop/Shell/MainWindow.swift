import ArgusUI
import SwiftUI

/// The three panels: workspace sidebar, agent control, runtime.
struct MainWindow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var imageViewer = ImageViewerState()
  @State private var columns: NavigationSplitViewVisibility = .all
  /// The sidebar was hidden to make room, not by the user, so it comes back.
  @State private var sidebarAutoHidden = false
  @State private var windowWidth: CGFloat = 0

  var body: some View {
    NavigationSplitView(columnVisibility: $columns) {
      SidebarView()
        .navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 360)
    } content: {
      VStack(spacing: 0) {
        WindowTabStrip()
        HostOfflineBanner()
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
      .navigationSplitViewColumnWidth(min: contentMinWidth, ideal: max(contentMinWidth, 640))
    } detail: {
      RuntimePanel(sessionId: model.route.sessionId)
        .navigationSplitViewColumnWidth(min: 280, ideal: 420)
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
      windowWidth = width
      fitColumns()
    }
    .onChange(of: model.route) { fitColumns() }
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
    .sheet(item: hostFolderRequest) { HostFolderPicker(request: $0) }
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
  /// The git panel nests its own sidebar, file list and diff; a column narrower
  /// than they need clips the app sidebar and runtime panel instead.
  static let gitContentMinWidth: CGFloat = 800
  static let contentMinWidth: CGFloat = 420
  /// Centre and runtime minimums with the git panel open and the sidebar hidden.
  static let minWindowWidth: CGFloat = gitContentMinWidth + 280
  /// Below this the git panel's split views would draw over the sidebar.
  static let roomyGitWidth: CGFloat = 1480

  /// The app sidebar gives way first when the git panel needs the room, so
  /// the runtime panel keeps its place; it comes back once there's space.
  private func fitColumns() {
    let cramped = model.route.gitView != nil && windowWidth > 0 && windowWidth < Self.roomyGitWidth
    if cramped, columns == .all {
      columns = .doubleColumn
      sidebarAutoHidden = true
    } else if !cramped, sidebarAutoHidden {
      if columns == .doubleColumn { columns = .all }
      sidebarAutoHidden = false
    }
  }

  private var contentMinWidth: CGFloat {
    model.route.gitView == nil ? Self.contentMinWidth : Self.gitContentMinWidth
  }

  private var hostFolderRequest: Binding<HostFolderRequest?> {
    Binding(get: { model.hostFolderRequest }, set: { model.hostFolderRequest = $0 })
  }

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
      .font(prefs.bodyFont)
  }
}

extension View {
  func themed() -> some View { modifier(Themed()) }
}
