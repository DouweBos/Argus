import ArgusCore
import ArgusUI
import SwiftUI

/// Argus Server: a menu-bar item over the bundled host, no Dock tile, no main
/// window. The few things a menu line can't hold open small windows.
@main
struct ArgusServerApp: App {
  @NSApplicationDelegateAdaptor(ServerAppDelegate.self) private var delegate

  var body: some Scene {
    MenuBarExtra {
      ServerMenuContent(model: delegate.model)
    } label: {
      ServerMenuLabel(model: delegate.model)
    }
    .menuBarExtraStyle(.menu)

    Window("Pair a Device", id: ServerModel.Window.pairing.rawValue) {
      PairingWindow(model: delegate.model).themed()
    }
    .windowResizability(.contentSize)
    .defaultLaunchBehavior(.suppressed)
    .restorationBehavior(.disabled)

    Window("Link to Your Argus Account", id: ServerModel.Window.link.rawValue) {
      LinkWindow(model: delegate.model).themed()
    }
    .windowResizability(.contentSize)
    .defaultLaunchBehavior(.suppressed)
    .restorationBehavior(.disabled)

    Window("Approve a Join", id: ServerModel.Window.approval.rawValue) {
      ApprovalWindow(model: delegate.model).themed()
    }
    .windowResizability(.contentSize)
    .defaultLaunchBehavior(.suppressed)
    .restorationBehavior(.disabled)

    Settings {
      ServerSettingsView(model: delegate.model).themed()
    }
  }
}
