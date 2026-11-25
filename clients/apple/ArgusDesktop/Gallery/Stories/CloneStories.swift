#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The Clone Repository sheet — the same ids and fixtures as the iOS gallery's.
  enum CloneStories {
    private static let sheet = CGSize(width: 560, height: 0)

    static var all: [GalleryStory] {
      [
        GalleryStory("projects/clone", size: sheet, fixtures: GalleryFixtures.cloneIdle) { CloneRepositorySheet() },
        GalleryStory("projects/clone/taken", size: sheet, fixtures: GalleryFixtures.cloneTaken) {
          CloneRepositorySheet(url: "https://github.com/houwert/tally.git")
        },
        GalleryStory("projects/clone/running", size: sheet, fixtures: GalleryFixtures.cloneRunning) {
          CloneRepositorySheet(cloneId: GalleryFixtures.cloneJobId)
        },
        GalleryStory("projects/clone/failed", size: sheet, fixtures: GalleryFixtures.cloneFailed) {
          CloneRepositorySheet(cloneId: GalleryFixtures.cloneJobId)
        },
      ]
    }
  }
#endif
