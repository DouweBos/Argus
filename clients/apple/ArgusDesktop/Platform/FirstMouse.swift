import AppKit

/// Lists and tables take the click that brings a background window forward,
/// like Finder's sidebar: without it a sidebar or table row needs a second
/// click. SwiftUI's `List` and `Table` give no way to ask for this — their
/// rows are hosting views that refuse the first mouse, so AppKit would spend
/// the click on bringing the window forward — so the click selects its row.
enum FirstMouse {
  @MainActor private static var monitor: Any?

  @MainActor static func install() {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
      // Monitors run on the main thread, with the event it is about to dispatch.
      nonisolated(unsafe) let event = event
      let handled = MainActor.assumeIsolated {
        guard let window = event.window, !window.isKeyWindow || !NSApp.isActive,
          window.attachedSheet == nil, let table = table(under: event, in: window)
        else { return false }
        let row = table.row(at: table.convert(event.locationInWindow, from: nil))
        guard row >= 0, event.clickCount == 1, event.modifierFlags.intersection([.command, .shift]).isEmpty
        else { return false }
        guard NSApp.isActive else {
          // AppKit brings a background app forward from the click itself;
          // swallowing it left the app inactive until a double click. Let it
          // through and select the row once it has.
          DispatchQueue.main.async {
            table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
          }
          return false
        }
        window.makeKey()
        table.selectRowIndexes(IndexSet(integer: row), byExtendingSelection: false)
        return true
      }
      return handled ? nil : event
    }
  }

  @MainActor private static func table(under event: NSEvent, in window: NSWindow) -> NSTableView? {
    guard let root = window.contentView?.superview else { return nil }
    var view = root.hitTest(event.locationInWindow)
    while let current = view {
      if let table = current as? NSTableView { return table }
      view = current.superview
    }
    return nil
  }
}
