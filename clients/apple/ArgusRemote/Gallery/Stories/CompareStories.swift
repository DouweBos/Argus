#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// A compare run: its scored slots, and the project list folding them under one row.
  /// The same ids and fixtures as the Mac gallery's `CompareStories`.
  enum CompareStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("compare/run", fixtures: GalleryFixtures.compare, setup: load) {
          CompareRunScreen(groupId: GalleryFixtures.compareGroupId)
        },
        GalleryStory("compare/project", fixtures: GalleryFixtures.compare, setup: load) {
          ProjectView(repoRoot: "/Users/dev/Projects/Argus", name: "Argus")
        },
      ]
    }

    @MainActor
    private static func load(_ stage: GalleryStage) async {
      await stage.host.loadRunners()
      for project in stage.host.projects { await stage.host.loadSessions(repoRoot: project.repoRoot) }
    }
  }
#endif
