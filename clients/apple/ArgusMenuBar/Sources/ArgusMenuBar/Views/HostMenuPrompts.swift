import AppKit

/// The few questions a menu can't ask: native alerts, the app brought forward
/// first since a menu-bar item has no window of its own.
@MainActor
public enum HostMenuPrompts {
  public static func alert(_ message: String, _ detail: String, buttons: [String]) -> NSAlert {
    NSApp.activate()
    let alert = NSAlert()
    alert.messageText = message
    alert.informativeText = detail
    for button in buttons { alert.addButton(withTitle: button) }
    return alert
  }

  /// This computer's name on the account; nil when cancelled.
  public static func computerName(current: String) -> String? {
    let prompt = alert(
      "Rename This Computer", "This computer's name on your Argus account.", buttons: ["Rename", "Cancel"])
    let field = NSTextField(string: current)
    field.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
    prompt.accessoryView = field
    prompt.window.initialFirstResponder = field
    guard prompt.runModal() == .alertFirstButtonReturn else { return nil }
    let name = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? nil : name
  }

  public static func confirmUnlink() -> Bool {
    let prompt = alert(
      "Unlink this computer from your Argus account?",
      "Devices signed in to your account can no longer find or reach it. Devices paired with a code keep working.",
      buttons: ["Unlink", "Cancel"])
    prompt.alertStyle = .warning
    return prompt.runModal() == .alertFirstButtonReturn
  }
}
