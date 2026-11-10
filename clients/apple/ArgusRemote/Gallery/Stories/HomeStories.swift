#if DEBUG
  import ArgusCore
  import ArgusKit
  import ArgusUI
  import SwiftUI

  /// Home, every agent and a project's sessions, over the Mac's home fixtures.
  enum HomeStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("home/loaded", fixtures: GalleryFixtures.home, setup: load) { ProjectsView() },
        GalleryStory("home/empty", fixtures: GalleryFixtures.homeEmpty, setup: load) { ProjectsView() },
        GalleryStory("agents/overview", fixtures: GalleryFixtures.home, setup: load) { AllAgentsView() },
        GalleryStory("sessions/sidebar", fixtures: GalleryFixtures.home, setup: load) {
          ProjectView(repoRoot: GalleryFixtures.argusRoot, name: "Argus")
        },
      ]
    }

    @MainActor static func load(_ stage: GalleryStage) async {
      let computer = DeviceIdentity(
        deviceId: "mac", devPrivB64: "", devPubB64: "", desktopPubB64: "", url: "ws://studio.local:7777",
        capabilities: ["monitor", "control"], hostName: "Mac Studio")
      stage.app.pairedHosts = [computer]
      stage.app.identity = computer
      stage.app.activeHostId = computer.deviceId
      stage.app.loaded = true
      await GalleryFixtures.loadHome(stage.host)
      await stage.automations.refresh()
      await stage.proposals.refresh()
    }
  }
#endif
