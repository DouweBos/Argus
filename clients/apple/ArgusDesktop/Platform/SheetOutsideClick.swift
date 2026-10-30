import AppKit

/// A click on the window behind a sheet closes the sheet, the way Escape
/// would — so a sheet that blocks Escape (`interactiveDismissDisabled`, an
/// alert with no cancel) stays up too. Title bar clicks still move the window.
enum SheetOutsideClick {
  @MainActor private static var monitor: Any?

  @MainActor static func install() {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
      nonisolated(unsafe) let event = event
      let handled = MainActor.assumeIsolated {
        guard let window = event.window, var sheet = window.attachedSheet,
          window.contentLayoutRect.contains(event.locationInWindow)
        else { return false }
        // Only the topmost sheet goes; a sheet on a sheet closes first.
        while let child = sheet.attachedSheet { sheet = child }
        guard
          let escape = NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: [], timestamp: event.timestamp,
            windowNumber: sheet.windowNumber, context: nil, characters: "\u{1b}",
            charactersIgnoringModifiers: "\u{1b}", isARepeat: false, keyCode: 53)
        else { return false }
        sheet.makeKey()
        NSApp.sendEvent(escape)
        return true
      }
      return handled ? nil : event
    }
  }
}
