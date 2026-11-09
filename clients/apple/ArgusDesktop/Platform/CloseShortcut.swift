import AppKit

/// ⌘W in the main window closes a tab, never the window. SwiftUI's File › Close
/// owns ⌘W and strips it from View › Close Tab, so the key is taken here first.
enum CloseShortcut {
  @MainActor private static var monitor: Any?

  @MainActor static func install(_ model: DesktopModel) {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak model] event in
      nonisolated(unsafe) let event = event
      let handled = MainActor.assumeIsolated {
        guard let model, isCommandW(event),
          let window = event.window ?? NSApp.window(withWindowNumber: event.windowNumber),
          window.identifier?.rawValue.hasPrefix("main") == true, window.attachedSheet == nil
        else { return false }
        // A focused terminal closes its own tab.
        if !window.performKeyEquivalent(with: event) { model.closeTabOrEditor() }
        return true
      }
      return handled ? nil : event
    }
  }

  static func isCommandW(_ event: NSEvent) -> Bool {
    event.type == .keyDown
      && event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock]) == .command
      && event.charactersIgnoringModifiers?.lowercased() == "w"
  }
}
