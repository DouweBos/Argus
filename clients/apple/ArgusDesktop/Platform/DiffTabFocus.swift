import AppKit
import SwiftUI

/// Whether the Diff tab has the keys. Its rows don't take first responder, so a click inside counts too.
struct DiffTabFocus: NSViewRepresentable {
  let changed: (Bool) -> Void

  func makeNSView(context: Context) -> FocusView {
    let view = FocusView()
    view.changed = changed
    return view
  }

  func updateNSView(_ view: FocusView, context: Context) {}

  static func dismantleNSView(_ view: FocusView, coordinator: ()) {
    view.stop()
  }

  final class FocusView: NSView {
    var changed: ((Bool) -> Void)?
    private var monitor: Any?
    private var responder: NSKeyValueObservation?
    private var focused = false

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
      super.viewDidMoveToWindow()
      stopObserving()
      guard let window else { return }
      monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] event in
        nonisolated(unsafe) let event = event
        MainActor.assumeIsolated {
          guard let self, let window = self.window, event.window === window else { return }
          self.set(self.bounds.contains(self.convert(event.locationInWindow, from: nil)))
        }
        return event
      }
      responder = window.observe(\.firstResponder) { [weak self] _, _ in
        Task { @MainActor in self?.responderMoved() }
      }
    }

    /// ⌘L and the like move typing out of the tab without a click.
    private func responderMoved() {
      guard focused, let view = window?.firstResponder as? NSView, view is NSTextInputClient else { return }
      let frame = convert(view.bounds, from: view)
      if !bounds.intersects(frame) { set(false) }
    }

    private func set(_ value: Bool) {
      guard value != focused else { return }
      focused = value
      changed?(value)
    }

    private func stopObserving() {
      if let monitor { NSEvent.removeMonitor(monitor) }
      monitor = nil
      responder = nil
    }

    func stop() {
      stopObserving()
      set(false)
    }
  }
}
