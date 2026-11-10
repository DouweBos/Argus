#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// `ARGUS_GALLERY=render`: the app comes up as the component gallery
  /// (`pnpm gallery --ios`) instead of the app. Read from the environment or, as
  /// conductor passes them, launch arguments (`-ARGUS_GALLERY render`).
  enum GalleryMode {
    static func value(_ key: String) -> String? {
      ProcessInfo.processInfo.environment[key] ?? UserDefaults.standard.string(forKey: key)
    }

    static var active: Bool { value("ARGUS_GALLERY") == "render" }
  }

  /// One gallery entry: a view in a known state, fed by fixtures instead of a
  /// host. `id` matches the Mac story it mirrors, so the two compare side by side.
  struct GalleryStory: Identifiable {
    let id: String
    /// A whole screen (the window), or a component cropped to its own height.
    var screen = true
    /// Wrapped in a navigation stack, so a screen's title and toolbar render.
    var chrome = true
    var fixtures: [String: String] = [:]
    /// Runs after the stores are attached, before the view appears.
    var setup: @MainActor (GalleryStage) async -> Void = { _ in }
    let content: @MainActor () -> AnyView

    init(
      _ id: String, screen: Bool = true, chrome: Bool = true, fixtures: [String: String] = [:],
      setup: @escaping @MainActor (GalleryStage) async -> Void = { _ in },
      @ViewBuilder content: @escaping @MainActor () -> some View
    ) {
      self.id = id
      self.screen = screen
      self.chrome = chrome
      self.fixtures = fixtures
      self.setup = setup
      self.content = { AnyView(content()) }
    }
  }

  /// Fresh stores per story, attached to its fixtures, wired into the same
  /// environment `RootView` gives the app's screens.
  @MainActor
  final class GalleryStage {
    let app = AppStore()
    let router = Router()
    let automations: AutomationsStore
    let proposals: ProposalsStore
    let pullRequests: PullRequestsStore
    let imageViewer = ImageViewerState()
    let backend: GalleryBackend
    var host: HostStore { app.host }

    init(story: GalleryStory) async {
      backend = GalleryBackend(story.fixtures)
      automations = AutomationsStore(host: app.host)
      proposals = ProposalsStore(host: app.host)
      pullRequests = PullRequestsStore(host: app.host)
      app.host.capabilities = ["monitor", "control", "admin"]
      await app.host.attach(backend)
      if story.fixtures[RemoteMethod.projectsList.rawValue] != nil { await app.host.refreshProjects() }
      await story.setup(self)
    }

    func view(_ story: GalleryStory, theme: Theme) -> some View {
      Group {
        if story.chrome {
          NavigationStack { story.content() }
        } else {
          story.content()
        }
      }
      .environment(app)
      .environment(app.host)
      .environment(router)
      .environment(automations)
      .environment(proposals)
      .environment(pullRequests)
      .environment(imageViewer)
      .environment(\.theme, theme)
      .tint(theme.accent)
    }
  }

  enum GalleryStories {
    static var all: [GalleryStory] {
      ComposerStories.all + SettingsStories.all + DeviceStories.all + FileStories.all + HomeStories.all + AutomationStories.all
    }
  }
#endif
