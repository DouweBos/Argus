import ArgusKit
import SwiftUI

@main
struct ArgusRemoteApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

  var body: some Scene {
    WindowGroup {
      RootView()
    }
  }
}
