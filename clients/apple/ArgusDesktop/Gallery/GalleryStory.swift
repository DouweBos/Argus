#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// One gallery entry: a view in a known state, fed by fixtures instead of a host.
  /// `id` is a path (`automations/quick-run/filled`); `pnpm gallery <filter>` matches on it.
  struct GalleryStory: Identifiable {
    let id: String
    /// Points. A zero height fits the content (component stories); screens give both.
    var size = CGSize(width: 640, height: 0)
    /// A titled window with a navigation stack, so a screen's title and toolbar render.
    var chrome = false
    /// Wire-format JSON replies, by method or command name.
    var fixtures: [String: String] = [:]
    /// Runs after the stores are attached, before the view appears.
    var setup: @MainActor (GalleryStage) async -> Void = { _ in }
    let content: @MainActor () -> AnyView

    init(
      _ id: String, size: CGSize = CGSize(width: 640, height: 0), chrome: Bool = false,
      fixtures: [String: String] = [:], setup: @escaping @MainActor (GalleryStage) async -> Void = { _ in },
      @ViewBuilder content: @escaping @MainActor () -> some View
    ) {
      self.id = id
      self.size = size
      self.chrome = chrome
      self.fixtures = fixtures
      self.setup = setup
      self.content = { AnyView(content()) }
    }
  }

  /// Fresh stores per story, attached to its fixtures, wired into the same
  /// environment the main window gives its views.
  @MainActor
  final class GalleryStage {
    let model: DesktopModel
    let host = HostStore()
    let automations: AutomationsStore
    let backend: GalleryBackend

    init(story: GalleryStory, model: DesktopModel) async {
      self.model = model
      backend = GalleryBackend(story.fixtures)
      automations = AutomationsStore(host: host)
      host.capabilities = ["monitor", "control", "admin"]
      await host.attach(backend)
      if story.fixtures[RemoteMethod.projectsList.rawValue] != nil { await host.refreshProjects() }
      await story.setup(self)
    }

    func view(_ story: GalleryStory) -> some View {
      Group {
        if story.chrome {
          NavigationStack { story.content() }
        } else {
          story.content()
        }
      }
      .environment(model)
      .environment(host)
      .environment(automations)
      .environment(model.terminals)
      .environment(model.pullRequests)
      .environment(model.runtime)
      .environment(model.proposals)
      .environment(model.hosts)
      .environment(model.account)
      .themed()
    }
  }

  enum GalleryStories {
    static var all: [GalleryStory] { AutomationStories.all + ComposerStories.all + SessionStories.all }
  }

  /// Fixture JSON from plain dictionaries, in wire (snake_case) keys.
  enum GalleryJSON {
    static func encode(_ value: Any) -> String {
      let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
      return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    static func projects(_ names: [String]) -> String {
      encode(["projects": names.map { ["repo_root": "/Users/dev/Projects/\($0)", "name": $0] }])
    }

    static let someProjects = [
      "react-native-client", "Argus", "Maestro", "luma", "conductor", "houwert.dev",
      "vizbee-chromecast-receiver", "apple-client", "Grove", "Charon", "web-tv-client", "iOS-App",
    ]
  }
#endif
