import ArgusUI
import SwiftUI

/// The three panels: workspace sidebar, agent control, and the side panel's tabs.
struct MainWindow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var imageViewer = ImageViewerState()
  @State private var columns: NavigationSplitViewVisibility = .all
  /// The sidebar was hidden to make room, not by the user, so it comes back.
  @State private var sidebarAutoHidden = false
  @State private var windowWidth: CGFloat = 0

  /// The device whose details are open, as the route says.
  private var deviceSelection: Binding<DeviceRef?> {
    Binding(
      get: {
        guard case .device(let platform, let key) = model.route else { return nil }
        return DeviceRef(platform: platform, deviceKey: key)
      },
      set: { ref in
        let next: DesktopRoute = ref.map { .device(platform: $0.platform, deviceKey: $0.deviceKey) } ?? .devices
        if next != model.route { model.navigate(next) }
      })
  }

  var body: some View {
    NavigationSplitView(columnVisibility: $columns) {
      SidebarView()
        // Room for the screens along the sidebar's foot.
        .navigationSplitViewColumnWidth(min: 256, ideal: 272, max: 380)
    } detail: {
      // The side panel keeps the width it was given and the centre takes the
      // rest; a split view's detail column would grow with the window and
      // leave the chat squeezed. Maximized, it covers the centre, which stays
      // laid out underneath so the session's toolbar keeps its items.
      ResizableHSplit(
        width: panelWidth, leadingMin: contentMinWidth,
        trailingMin: SidePanelModel.minWidth, trailingMax: SidePanelModel.maxWidth,
        showsTrailing: model.sidePanelVisible && !panelMaximized
      ) {
        centre.overlay {
          if panelMaximized { SidePanel(sessionId: model.route.sessionId) }
        }
      } trailing: {
        SidePanel(sessionId: model.route.sessionId)
      }
      .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { model.toolbarLayout.detailWidth = $0 }
      .modifier(CanvasBackground())
    }
    // One flat canvas: the toolbar draws no bar of its own over it.
    .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
      windowWidth = width
      fitColumns()
    }
    .onChange(of: model.route) { fitColumns() }
    // One image viewer for the window: a card over the window, as the desktop shows one.
    .overlay { ImageViewerPanel() }
    .onChange(of: imageViewer.isPresented) { _, shown in
      if shown { MacTelemetry.capture(.imageViewerUsed(action: .open)) }
    }
    .overlay(alignment: .top) {
      if model.palette.isPresented {
        ZStack(alignment: .top) {
          PaletteScrim { model.palette.isPresented = false }
          CommandPaletteView().padding(.top, 72)
        }
      }
    }
    .modifier(ProjectFlows())
    .modifier(HandoffActivity())
    .sheet(item: projectSettingsRepo) { repo in
      ProjectSettingsSheet(repoRoot: repo.path)
    }
    .sheet(item: hostFolderRequest) { HostFolderPicker(request: $0) }
    .environment(imageViewer)
    .environment(\.codeOpener, model)
    .toolbar { HistoryButtons() }
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
  /// The centre panel: whatever the route shows.
  private var centre: some View {
    VStack(spacing: 0) {
      WindowTabStrip()
      HostOfflineBanner()
      StoreErrorBanner()
      HuddleJoinRequests()
      Group {
        if let sessionId = model.route.sessionId {
          SessionView(sessionId: sessionId)
        } else if model.route == .agents {
          AgentsOverview()
        } else if model.route == .runtimes {
          RuntimesOverview()
        } else if model.route.isDevices {
          DevicesScreen(selection: deviceSelection)
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
  }

  /// The git panel's own sidebar (230), the changes list's minimum (220) and
  /// the diff's (280); its panes narrow down to these, so nothing is clipped.
  static let gitContentMinWidth: CGFloat = 740
  static let contentMinWidth: CGFloat = 420
  /// Centre and side panel minimums with the git panel open and the sidebar hidden.
  static let minWindowWidth: CGFloat = gitContentMinWidth + SidePanelModel.minWidth + 7
  /// App sidebar, git panel and side panel at their minimums.
  static let roomyGitWidth: CGFloat = 1260

  private var panelMaximized: Bool { model.panels.isMaximized(model.route.sessionId) }

  /// The width the panel was left at in the session on screen.
  private var panelWidth: Binding<Double> {
    let session = model.route.sessionId
    return Binding(
      get: { model.panels.width(session) },
      set: { model.panels.setWidth($0, session: session) })
  }

  /// The app sidebar gives way first when the git panel needs the room, so
  /// the side panel keeps its place; it comes back once there's space.
  private func fitColumns() {
    let cramped = model.route.gitView != nil && windowWidth > 0 && windowWidth < Self.roomyGitWidth
    if cramped, columns == .all {
      columns = .detailOnly
      sidebarAutoHidden = true
    } else if !cramped, sidebarAutoHidden {
      if columns == .detailOnly { columns = .all }
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
    let theme = Theme.resolved(for: colorScheme, colorTheme: prefs.colorTheme)
    content
      .environment(\.theme, theme)
      .tint(theme.tint)
      .dynamicTypeSize(prefs.dynamicTypeSize)
      .controlSize(prefs.controlSize)
      .font(prefs.bodyFont)
  }
}

extension View {
  func themed() -> some View { modifier(Themed()) }
}

/// Dims the window behind the palette; a click outside closes it.
private struct PaletteScrim: View {
  @Environment(\.theme) private var theme
  let close: () -> Void

  var body: some View {
    theme.scrim
      .ignoresSafeArea()
      .contentShape(.rect)
      .onTapGesture(perform: close)
      .accessibilityHidden(true)
  }
}

/// The window's flat canvas, up under the toolbar; a modifier so it reads the themed environment.
private struct CanvasBackground: ViewModifier {
  @Environment(\.theme) private var theme

  func body(content: Content) -> some View {
    content.background(theme.bg.ignoresSafeArea())
  }
}
