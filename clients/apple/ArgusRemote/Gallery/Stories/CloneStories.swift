#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Clone Repository — the same ids and fixtures as the Mac gallery's.
  enum CloneStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("projects/clone", fixtures: GalleryFixtures.cloneIdle) { CloneRepositoryView() },
        GalleryStory("projects/clone/taken", fixtures: GalleryFixtures.cloneTaken) {
          CloneRepositoryView(url: "https://github.com/houwert/tally.git")
        },
        GalleryStory("projects/clone/running", fixtures: GalleryFixtures.cloneRunning) {
          CloneRepositoryView(cloneId: GalleryFixtures.cloneJobId)
        },
        GalleryStory("projects/clone/failed", fixtures: GalleryFixtures.cloneFailed) {
          CloneRepositoryView(cloneId: GalleryFixtures.cloneJobId)
        },
      ]
    }
  }
#endif
