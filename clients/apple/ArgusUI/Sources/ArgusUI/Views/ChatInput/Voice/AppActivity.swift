#if os(macOS)
  import AppKit
#else
  import UIKit
#endif

/// Whether Argus is the app in front, for voice mode's "only in the background".
@MainActor
enum AppActivity {
  static var isForeground: Bool {
    #if os(macOS)
      NSApplication.shared.isActive
    #else
      UIApplication.shared.applicationState == .active
    #endif
  }
}
