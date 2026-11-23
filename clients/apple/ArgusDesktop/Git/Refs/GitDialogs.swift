import AppKit

/// Confirmations for git actions, on the panel's window. Context menus and
/// toolbar items have no view that outlives them to hang an alert on.
@MainActor
enum GitDialogs {
  /// The window to present on: a background dev build has no key window.
  private static var window: NSWindow? {
    let key = NSApp.keyWindow.map { $0.sheetParent ?? $0 }
    return key ?? NSApp.mainWindow
      ?? NSApp.windows.first { $0.isVisible && $0.sheetParent == nil && $0.styleMask.contains(.titled) }
  }

  /// Asks before a destructive or hard-to-undo action.
  static func confirm(_ title: String, message: String, action: String, destructive: Bool = false) async -> Bool {
    await choose(title, message: message, buttons: [action], destructive: destructive) == 0
  }

  /// One of `buttons` (by index), or nil for Cancel.
  static func choose(_ title: String, message: String, buttons: [String], destructive: Bool = false) async -> Int? {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = message
    for (index, name) in buttons.enumerated() {
      let button = alert.addButton(withTitle: name)
      button.hasDestructiveAction = destructive && index == 0
    }
    alert.addButton(withTitle: "Cancel")
    let response: NSApplication.ModalResponse
    if let window {
      response = await alert.beginSheetModal(for: window)
    } else {
      response = alert.runModal()
    }
    let index = response.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    return buttons.indices.contains(index) ? index : nil
  }
}
