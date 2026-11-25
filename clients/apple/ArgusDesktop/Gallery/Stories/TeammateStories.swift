#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Teammates: the list, the gallery and one teammate's pages — the same ids
  /// and fixtures as the iOS gallery's `TeammateStories`.
  enum TeammateStories {
    private static let screen = CGSize(width: 1100, height: 760)

    static var all: [GalleryStory] {
      [
        GalleryStory(
          "teammates/list", size: CGSize(width: 1100, height: 640), chrome: true, fixtures: fixtures,
          setup: attach
        ) { TeammatesScreen() },
        GalleryStory(
          "teammates/list/empty", size: CGSize(width: 1000, height: 560), chrome: true,
          fixtures: GalleryFixtures.teammates(empty: true), setup: attach
        ) { TeammatesScreen() },
        GalleryStory(
          "teammates/gallery", size: CGSize(width: 1100, height: 820), chrome: true, fixtures: fixtures,
          setup: attach
        ) { TeammateGalleryScreen() },
        GalleryStory(
          "teammates/chat", size: screen, chrome: true, fixtures: fixtures, setup: attach
        ) { TeammateScreen(teammateId: GalleryFixtures.ciFixerId, page: .chat(threadId: nil)) },
        GalleryStory(
          "teammates/chat/failed", size: screen, chrome: true, fixtures: GalleryFixtures.teammates(failed: true),
          setup: attach
        ) { TeammateScreen(teammateId: GalleryFixtures.ciFixerId, page: .chat(threadId: nil)) },
        GalleryStory(
          "teammates/profile", size: CGSize(width: 1000, height: 1500), chrome: true, fixtures: fixtures,
          setup: attach
        ) { TeammateScreen(teammateId: GalleryFixtures.ciFixerId, page: .profile) },
        GalleryStory(
          "teammates/duties", size: CGSize(width: 1000, height: 600), chrome: true, fixtures: fixtures,
          setup: attach
        ) { TeammateScreen(teammateId: GalleryFixtures.ciFixerId, page: .duties) },
        GalleryStory(
          "teammates/memory", size: CGSize(width: 1000, height: 600), chrome: true, fixtures: fixtures,
          setup: attach
        ) { TeammateScreen(teammateId: GalleryFixtures.ciFixerId, page: .memory) },
      ]
    }

    private static var fixtures: [String: String] { GalleryFixtures.teammates() }

    @MainActor
    private static func attach(_ stage: GalleryStage) async {
      await stage.model.store.attach(stage.backend)
      await stage.model.store.refreshProjects()
      await stage.teammates.refresh()
      await stage.automations.refresh()
    }
  }
#endif
