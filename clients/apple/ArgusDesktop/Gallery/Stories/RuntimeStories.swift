#if DEBUG
  import ArgusCore
  import SwiftUI

  /// The Runtimes overview: run commands across sessions, with the ports Argus gave them.
  enum RuntimeStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "runtimes/overview", size: CGSize(width: 1300, height: 360), chrome: true, fixtures: GalleryFixtures.home,
          setup: { stage in
            await HomeStories.load(stage)
            stage.model.terminals.galleryFill(tabs)
          }
        ) { RuntimesOverview() },
        // Sessions on a paired Mac: one port forwarded to this Mac, the others offered.
        GalleryStory(
          "runtimes/overview/remote", size: CGSize(width: 1300, height: 360), chrome: true,
          fixtures: GalleryFixtures.home,
          setup: { stage in
            await HomeStories.load(stage)
            stage.model.terminals.galleryFill(tabs)
            stage.model.galleryHosts = ["rn-1": "mac-mini", "rn-2": "mac-mini"]
            stage.model.portForwards.galleryFill([
              (.init(hostId: "mac-mini", sessionId: "rn-2", port: 3012), localPort: 3012)
            ])
          }
        ) { RuntimesOverview() },
        // The Device tab on a capture card: nothing picked yet, and another computer's session.
        GalleryStory("runtimes/video-input/none", size: CGSize(width: 520, height: 420)) {
          VideoInputView(input: nil, local: true)
        },
        GalleryStory("runtimes/video-input/remote", size: CGSize(width: 520, height: 420)) {
          VideoInputView(input: VideoInputs.Input(id: "card", name: "Elgato HD60 X"), local: false)
        },
      ]
    }

    private static func env(_ pairs: (String, String)...) -> [TerminalsStore.EnvVar] {
      pairs.map { TerminalsStore.EnvVar(name: $0.0, value: $0.1) }
    }

    private static var tabs: [TerminalsStore.Tab] {
      [
        .init(
          id: "t1", sessionId: "rn-1", title: "Metro (Native)", runTitle: "Metro (Native)",
          workspaceEnv: env(("RCT_METRO_PORT", "8085"))),
        .init(
          id: "t2", sessionId: "rn-2", title: "Metro (Native)", runTitle: "Metro (Native)",
          workspaceEnv: env(("RCT_METRO_PORT", "8086"))),
        .init(
          id: "t3", sessionId: "rn-2", title: "Luma API", runTitle: "Luma API",
          workspaceEnv: env(("PORT", "3012"), ("API_PORT", "4012"))),
        .init(id: "t4", sessionId: "rn-root", title: "Storybook", runTitle: "Storybook"),
        .init(
          id: "t5", sessionId: "rn-1", title: "Plex pod install", runTitle: "Plex pod install", exitCode: 0,
          workspaceEnv: env(("RCT_METRO_PORT", "8085"))),
      ]
    }
  }
#endif
