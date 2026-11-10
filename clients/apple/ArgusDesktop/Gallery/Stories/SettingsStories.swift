#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The Settings window and its Argus Account page in each state.
  enum SettingsStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("settings/window", size: CGSize(width: 960, height: 680), setup: { stage in
          stage.model.settingsTab = .appearance
          stage.model.account.galleryFill(GalleryAccount(selfKind: "mac"))
        }) {
          SettingsWindow()
        },
        GalleryStory("settings/appearance", size: page) { AppearanceSettingsTab() },
        account("signed-in", GalleryAccount(selfKind: "mac")),
        account("signed-out", GalleryAccount(phase: .signedOut, selfKind: "mac")),
        account("awaiting-approval", GalleryAccount(phase: .awaitingApproval, selfKind: "mac")),
      ]
    }

    private static let page = CGSize(width: 760, height: 900)

    private static func account(_ state: String, _ fixture: GalleryAccount) -> GalleryStory {
      GalleryStory(
        "settings/account/\(state)", size: CGSize(width: 760, height: 1400),
        setup: { stage in stage.model.account.galleryFill(fixture) }
      ) {
        AccountSettingsTab()
      }
    }
  }
#endif
