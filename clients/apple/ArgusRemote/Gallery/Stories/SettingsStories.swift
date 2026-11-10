#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Settings and its Account page in each state, the Mac's ids.
  enum SettingsStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("settings/window", setup: { stage in
          stage.app.account.galleryFill(GalleryAccount(selfKind: "ios"))
        }) {
          SettingsView()
        },
        GalleryStory("settings/appearance") { AppearanceSettingsPage() },
        account("signed-in", GalleryAccount(selfKind: "ios")),
        account("signed-out", GalleryAccount(phase: .signedOut, selfKind: "ios")),
        account("awaiting-approval", GalleryAccount(phase: .awaitingApproval, selfKind: "ios")),
      ]
    }

    private static func account(_ state: String, _ fixture: GalleryAccount) -> GalleryStory {
      GalleryStory("settings/account/\(state)", setup: { stage in stage.app.account.galleryFill(fixture) }) {
        AccountView()
      }
    }
  }
#endif
