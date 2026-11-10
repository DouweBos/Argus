#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Quick Open over a worktree's files, the Mac's ids.
  enum FileStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("files/quick-open", fixtures: GalleryFixtures.files) {
          QuickOpenView(sessionId: "s1", label: "quick-open-polish")
        },
      ]
    }
  }
#endif
