import AppKit
import Observation

/// Whether the main window is the key one. ⌘W closes a tab there and the
/// window itself anywhere else — a popout, DevTools, Settings — so the menu
/// item has to know which it is acting on.
@MainActor
@Observable
final class KeyWindow {
  static let shared = KeyWindow()

  private(set) var isMain = true
  @ObservationIgnored private var observers: [NSObjectProtocol] = []

  private init() {
    let center = NotificationCenter.default
    for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { _ in
          MainActor.assumeIsolated { KeyWindow.shared.update() }
        })
    }
  }

  /// The main window or a sheet on it; no key window counts as main too.
  static func isMain(_ window: NSWindow?) -> Bool {
    guard let window else { return true }
    return (window.sheetParent ?? window).identifier?.rawValue.hasPrefix("main") == true
  }

  private func update() {
    isMain = Self.isMain(NSApp.keyWindow)
  }

  /// ⌘W: the key window when it isn't the main one.
  func closeOther() -> Bool {
    guard let window = NSApp.keyWindow, !Self.isMain(window) else { return false }
    window.performClose(nil)
    return true
  }
}
