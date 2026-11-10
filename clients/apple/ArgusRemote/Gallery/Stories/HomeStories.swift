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
        setup("sessions/setup/progress", "s-setup"),
        setup("sessions/setup/failed", "s-failed"),
        GalleryStory("sessions/context-card", fixtures: GalleryFixtures.home, setup: load) {
          SessionDetailsView(
            session: GalleryFixtures.argusSession("s-long"), agentId: "a-perm", open: { _ in }, newAgent: {},
            deleted: {})
        },
      ]
    }

    /// A session's screen while its worktree is set up, or after that failed.
    private static func setup(_ id: String, _ session: String) -> GalleryStory {
      GalleryStory(id, fixtures: GalleryFixtures.home, setup: load) {
        SessionView(sessionId: session, label: "Session", repoRoot: GalleryFixtures.argusRoot)
      }
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
