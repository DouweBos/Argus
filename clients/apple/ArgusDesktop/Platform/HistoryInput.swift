import AppKit
import Carbon.HIToolbox

/// Back and forward from outside the menus: a mouse's side buttons anywhere in
/// the main window, as Finder and Electron take them, and the code view's
/// VS Code keys (⌃- / ⌃⇧-), which the Go menu's ⌘[ / ⌘] items leave out.
enum HistoryInput {
  @MainActor private static var monitor: Any?

  @MainActor static func install(_ model: DesktopModel) {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: [.otherMouseUp, .keyDown]) { [weak model] event in
      // Monitors run on the main thread, with the event it is about to dispatch.
      nonisolated(unsafe) let event = event
      let handled = MainActor.assumeIsolated {
        guard let model, let action = action(for: event, codeView: model.activeCodeSession != nil),
          (event.window ?? NSApp.window(withWindowNumber: event.windowNumber)).map(isMain) == true
        else { return false }
        switch action.direction {
        case .back: model.goBack(via: action.via)
        case .forward: model.goForward(via: action.via)
        }
        return true
      }
      return handled ? nil : event
    }
  }

  /// Buttons 3 and 4 are a mouse's back and forward, as Electron reads them.
  static func action(for event: NSEvent, codeView: Bool)
    -> (direction: MacTelemetryEvent.HistoryDirection, via: MacTelemetryEvent.HistorySource)?
  {
    switch event.type {
    case .otherMouseUp:
      switch event.buttonNumber {
      case 3: return (.back, .mouse)
      case 4: return (.forward, .mouse)
      default: return nil
      }
    case .keyDown:
      guard codeView, Int(event.keyCode) == kVK_ANSI_Minus else { return nil }
      switch event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .function, .numericPad]) {
      case [.control]: return (.back, .shortcut)
      case [.control, .shift]: return (.forward, .shortcut)
      default: return nil
      }
    default: return nil
    }
  }

  /// History is the main window's; popouts and Settings have none.
  @MainActor private static func isMain(_ window: NSWindow) -> Bool {
    window.identifier?.rawValue.hasPrefix("main") == true && window.attachedSheet == nil
  }
}
