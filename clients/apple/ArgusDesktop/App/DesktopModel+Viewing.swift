import ArgusCore
import Foundation

extension DesktopModel {
  /// Tells the host of the session on screen, so it keeps a warm agent there
  /// and ⇧⌘A or the start composer starts instantly. The host of a session left
  /// on another machine is told it's no longer shown.
  func viewedSessionChanged(from left: String?) {
    let shown = route.sessionId
    let leftHost = left.map { host(ofSession: $0) }
    let shownHost = shown.map { host(ofSession: $0) }
    Task {
      if let leftHost, leftHost != shownHost {
        await HostRouter.$pinned.withValue(leftHost) {
          await store.reportViewing(sessionId: nil)
        }
      }
      if let shown { await store.reportViewing(sessionId: shown) }
    }
  }
}
