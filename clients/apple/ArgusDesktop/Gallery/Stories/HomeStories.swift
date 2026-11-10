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
      ]
    }

    @MainActor static func load(_ stage: GalleryStage) async {
      await GalleryFixtures.loadHome(stage.host)
      await stage.model.automations.refresh()
      await stage.model.inbox.refresh()
    }
  }
#endif
