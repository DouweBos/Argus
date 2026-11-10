#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The phone's Devices list, the Mac's ids.
  enum DeviceStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "devices/list", fixtures: GalleryFixtures.deviceList, setup: { await $0.host.refreshDevices() }
        ) {
          DevicesView()
        }
      ]
    }
  }
#endif
