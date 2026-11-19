import AppKit
import SwiftUI

extension View {
  /// Keeps the toolbar transparent in fullscreen, as it is in a window.
  func flatFullScreenTitlebar() -> some View { background(FullScreenTitlebar()) }
}

/// In fullscreen AppKit moves the toolbar into a window of its own, which paints
/// a grey titlebar material and a separator that `.toolbarBackgroundVisibility`
/// never reaches. This hides both so the canvas shows through again.
private struct FullScreenTitlebar: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView { HookView() }
  func updateNSView(_ nsView: NSView, context: Context) {}

  private final class HookView: NSView {
    private var observers: [NSObjectProtocol] = []

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      // Also runs on removal, with no window: that drops the observers.
      observers.forEach(NotificationCenter.default.removeObserver)
      observers = []
      guard let window else { return }
      window.titlebarSeparatorStyle = .none
      let center = NotificationCenter.default
      observers.append(
        center.addObserver(forName: NSWindow.didEnterFullScreenNotification, object: window, queue: .main) {
          [weak self] _ in
          MainActor.assumeIsolated { self?.flatten() }
        })
      flatten()
    }

    private func flatten() {
      guard let window, window.styleMask.contains(.fullScreen),
        // The titlebar view, wherever AppKit hosts it right now.
        let titlebar = window.standardWindowButton(.closeButton)?.superview
      else { return }
      for view in titlebar.subviews where Self.isBackground(view) {
        view.isHidden = true
      }
    }

    private static func isBackground(_ view: NSView) -> Bool {
      view is NSVisualEffectView || String(describing: type(of: view)).contains("Background")
    }
  }
}
