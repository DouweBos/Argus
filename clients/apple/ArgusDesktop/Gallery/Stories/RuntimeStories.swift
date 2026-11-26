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
        // macOS apps: what macOS must allow first, the window picker, and a mirror that can only watch.
        GalleryStory("runtimes/macos-apps/permissions", size: CGSize(width: 520, height: 520)) {
          MacAppPermissionsView(apps: macApps(screenRecording: false, accessibility: false))
        },
        GalleryStory("runtimes/macos-apps/permissions/screen-recording", size: CGSize(width: 520, height: 520)) {
          MacAppPermissionsView(apps: macApps(screenRecording: false, accessibility: true))
        },
        GalleryStory("runtimes/macos-apps/picker", size: CGSize(width: 520, height: 720)) {
          MacAppPicker(apps: macApps(), selection: macAppWindows[2].target.key) { _ in }
        },
        GalleryStory("runtimes/macos-apps/picker/empty", size: CGSize(width: 520, height: 420)) {
          MacAppPicker(apps: MacApps(windows: [], permissions: .init(screenRecording: true, accessibility: true)), selection: nil) { _ in }
        },
        GalleryStory("runtimes/macos-apps/view-only", size: CGSize(width: 520, height: 420)) {
          Color.clear.overlay(alignment: .bottom) { MacAppViewOnlyBanner(appName: "TextEdit") {} }
        },
        GalleryStory("runtimes/macos-apps/remote", size: CGSize(width: 520, height: 420)) {
          MacAppMirrorView(apps: macApps(), selection: nil, local: false) { _ in }
        },
      ]
    }

    @MainActor private static func macApps(screenRecording: Bool = true, accessibility: Bool = true) -> MacApps {
      MacApps(
        windows: macAppWindows,
        permissions: MacAppPermissions(screenRecording: screenRecording, accessibility: accessibility))
    }

    private static let macAppWindows: [MacAppWindow] = [
      ("com.apple.calculator", "Calculator", "Calculator"),
      ("com.apple.iCal", "Calendar", "Week 48"),
      ("com.apple.finder", "Finder", "Downloads"),
      ("com.apple.Maps", "Maps", "Amsterdam"),
      ("com.apple.Music", "Music", "Recently Added"),
      ("com.apple.Notes", "Notes", "Release checklist"),
      ("com.apple.Preview", "Preview", "onboarding-flow.pdf"),
      ("com.apple.Safari", "Safari", "Luma — Dashboard"),
      ("com.apple.Safari", "Safari", "localhost:3012"),
      ("com.apple.systempreferences", "System Settings", "Privacy & Security"),
      ("com.apple.Terminal", "Terminal", "~/Projects/luma — zsh"),
      ("com.apple.TextEdit", "TextEdit", "Notes.txt"),
      ("com.apple.dt.Xcode", "Xcode", ""),
    ].enumerated().map { index, app in
      MacAppWindow(
        windowId: UInt32(100 + index), pid: 0, bundleId: app.0, appName: app.1, title: app.2,
        frame: CGRect(x: 0, y: 0, width: 1200, height: 800))
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
