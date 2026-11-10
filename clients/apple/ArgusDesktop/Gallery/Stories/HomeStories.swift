#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Home, the agents overview and the sidebar's projects, over a dozen projects.
  enum HomeStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "home/loaded", size: CGSize(width: 1100, height: 1100), chrome: true, fixtures: GalleryFixtures.home,
          setup: load
        ) { HomeScreen() },
        GalleryStory(
          "home/empty", size: CGSize(width: 1100, height: 700), chrome: true, fixtures: GalleryFixtures.homeEmpty,
          setup: load
        ) { HomeScreen() },
        GalleryStory(
          "agents/overview", size: CGSize(width: 1100, height: 480), chrome: true, fixtures: GalleryFixtures.home,
          setup: load
        ) { AgentsOverview() },
        GalleryStory(
          "sessions/sidebar", size: CGSize(width: 280, height: 1000), fixtures: GalleryFixtures.home, setup: load
        ) { SidebarView() },
        setup("sessions/setup/progress", "s-setup"),
        setup("sessions/setup/failed", "s-failed"),
        GalleryStory(
          "sessions/context-card", size: CGSize(width: 900, height: 700), fixtures: GalleryFixtures.home,
          setup: load
        ) {
          Color.clear.sessionContextCard(GalleryFixtures.argusSession("s-long"), panel: .agents)
        },
        GalleryStory(
          "sessions/context-card-setup-pending", size: CGSize(width: 900, height: 700),
          fixtures: GalleryFixtures.home, setup: load
        ) {
          Color.clear.sessionContextCard(
            GalleryFixtures.argusSession("s-long", overrides: ["setup_pending": true]), panel: .agents)
        },
        // Mac only: the phone starts a session from its composer, and deletes through a confirmation dialog.
        GalleryStory(
          "sessions/new-sheet", size: CGSize(width: 480, height: 560), fixtures: GalleryFixtures.home, setup: load
        ) {
          NewSessionSheet(project: GalleryFixtures.argusProject) { _ in }
        },
        GalleryStory(
          "sessions/delete-sheet", size: CGSize(width: 420, height: 0), fixtures: GalleryFixtures.home, setup: load
        ) {
          DeleteSessionSheet(session: GalleryFixtures.argusSession("s-long")) {}
        },
      ]
    }

    /// A session's pane while its worktree is set up, or after that failed.
    private static func setup(_ id: String, _ session: String) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 900, height: 480), fixtures: GalleryFixtures.home, setup: load) {
        let session = GalleryFixtures.argusSession(session)
        SessionSetupView(session: session, progress: session.progress)
      }
    }

    @MainActor static func load(_ stage: GalleryStage) async {
      await GalleryFixtures.loadHome(stage.host)
      await stage.model.automations.refresh()
      await stage.model.inbox.refresh()
    }
  }
#endif
