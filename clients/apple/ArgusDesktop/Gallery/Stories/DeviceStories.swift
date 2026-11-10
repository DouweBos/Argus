#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// `/devices`: running, stopped, remote and browser devices.
  enum DeviceStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "devices/list", size: CGSize(width: 1100, height: 520), chrome: true, fixtures: GalleryFixtures.deviceList
        ) {
          DevicesScreen()
        }
      ]
    }
  }
#endif
