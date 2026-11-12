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
        accountRemoved,
        GalleryStory("agents/overview", fixtures: GalleryFixtures.home, setup: load) { AllAgentsView() },
        GalleryStory("sessions/sidebar", fixtures: GalleryFixtures.home, setup: load) {
          ProjectView(repoRoot: GalleryFixtures.argusRoot, name: "Argus")
        },
        // The iPad's sidebar, at the width a split view gives it, against the Mac's `sessions/sidebar`.
        GalleryStory("sessions/sidebar/ipad", chrome: false, fixtures: GalleryFixtures.home, setup: load) {
          HStack(spacing: 0) {
            SessionSidebar().frame(width: 320)
            Spacer(minLength: 0)
          }
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

    /// Home under the app-wide notice that another device removed this phone from the account.
    private static var accountRemoved: GalleryStory {
      GalleryStory(
        "home/account-removed", fixtures: GalleryFixtures.home,
        setup: { stage in
          await load(stage)
          stage.app.account.galleryFill(GalleryAccount(phase: .signedOut, selfKind: "ios", removed: true))
        }
      ) {
        ProjectsView().safeAreaInset(edge: .top, spacing: 0) { AccountRemovedNotice() }
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
