import ArgusUI
import SwiftUI

@main
struct ArgusRemoteApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  var body: some Scene {
    WindowGroup {
      #if DEBUG
        if GalleryMode.active {
          GalleryRoot()
        } else {
          RootView()
        }
      #else
        RootView()
      #endif
    }
  }
}
