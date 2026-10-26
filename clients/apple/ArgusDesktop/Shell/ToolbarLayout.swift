import AppKit
import ArgusUI
import Observation
import SwiftUI

/// What the session toolbar measures, so the session's own controls never
/// overflow: the panel's actions take only the room between the switcher's
/// real right edge and those controls, and spill into their More menu first.
@MainActor
@Observable
final class ToolbarLayout {
  /// The switcher's right edge in the window. Measured, not derived from the
  /// detail column: the title and leading items push it right of centre once
  /// the sidebar is hidden or the window narrows.
  var switcherMaxX: CGFloat = 0
  var windowWidth: CGFloat = 0
  /// The session's own controls (share, run, terminal, device), always shown.
  private(set) var sessionToolsWidth: CGFloat = 0
  /// Their width with the run control titled, kept while it's compact so it can come back.
  private(set) var sessionToolsFullWidth: CGFloat = 0

  /// The switcher's toolbar item reaches ~4pt past it, the toolbar keeps at
  /// least 8pt after it, each of the two item capsules adds ~5pt around its
  /// content and the window edge 4pt; plus a little air.
  static let margin: CGFloat = 4 + 8 + 2 * 5 + 4 + 4

  /// Right of the switcher, what the session's controls and a panel's actions share.
  private var room: CGFloat {
    guard windowWidth > 0, switcherMaxX > 0 else { return .infinity }
    return windowWidth - switcherMaxX - Self.margin
  }

  /// Too narrow for the titled run control beside a panel's More menu: it drops
  /// its title rather than the toolbar overflowing the session's controls.
  var compactSessionTools: Bool {
    room < sessionToolsFullWidth + PillMetrics.iconWidth
  }

  /// Room for a panel's actions; they overflow into their More menu first.
  var panelActionsWidth: CGFloat {
    max(0, room - sessionToolsWidth)
  }

  func measuredSessionTools(_ width: CGFloat) {
    sessionToolsWidth = width
    if !compactSessionTools || sessionToolsFullWidth == 0 { sessionToolsFullWidth = width }
  }
}

/// Reports a toolbar item's right edge in its window and the window's width,
/// whenever the window resizes or the toolbar moves the item.
struct ToolbarItemProbe: NSViewRepresentable {
  let report: (_ maxX: CGFloat, _ windowWidth: CGFloat) -> Void

  func makeNSView(context: Context) -> ProbeView {
    let view = ProbeView()
    view.report = report
    return view
  }

  func updateNSView(_ view: ProbeView, context: Context) {
    view.report = report
    view.scheduleMeasure()
  }

  final class ProbeView: NSView {
    var report: ((CGFloat, CGFloat) -> Void)?
    private var observers: [NSObjectProtocol] = []
    private var last: (CGFloat, CGFloat)?

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      // Leaving the window drops them, so a removed item stops measuring.
      observers.forEach(NotificationCenter.default.removeObserver)
      observers = []
      guard let window else { return }
      let center = NotificationCenter.default
      observers.append(
        center.addObserver(forName: NSWindow.didResizeNotification, object: window, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.scheduleMeasure() }
        })
      // The toolbar moves an item by moving the viewer around it, not the item itself.
      var ancestor = superview
      for _ in 0..<4 {
        guard let view = ancestor else { break }
        view.postsFrameChangedNotifications = true
        observers.append(
          center.addObserver(forName: NSView.frameDidChangeNotification, object: view, queue: .main) {
            [weak self] _ in
            MainActor.assumeIsolated { self?.scheduleMeasure() }
          })
        ancestor = view.superview
      }
      scheduleMeasure()
    }

    override func layout() {
      super.layout()
      scheduleMeasure()
    }

    func scheduleMeasure() {
      DispatchQueue.main.async { [weak self] in self?.measure() }
    }

    private func measure() {
      guard let window else { return }
      let next = (convert(bounds, to: nil).maxX, window.frame.width)
      if let last, last == next { return }
      last = next
      report?(next.0, next.1)
    }
  }
}
