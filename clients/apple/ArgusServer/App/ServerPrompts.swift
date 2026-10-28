import AppKit
import ArgusCore

/// The few questions a menu can't ask: native alerts, the app brought forward
/// first since it has no window of its own.
@MainActor
enum ServerPrompts {
  private static func alert(_ message: String, _ detail: String, buttons: [String]) -> NSAlert {
    NSApp.activate()
    let alert = NSAlert()
    alert.messageText = message
    alert.informativeText = detail
    for button in buttons { alert.addButton(withTitle: button) }
    return alert
  }

  /// This computer's name on the account; nil when cancelled.
  static func computerName(current: String) -> String? {
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

  static func confirmUnlink() -> Bool {
    let prompt = alert(
      "Unlink this computer from your Argus account?",
      "Devices signed in to your account can no longer find or reach it. Devices paired with a code keep working.",
      buttons: ["Unlink", "Cancel"])
    prompt.alertStyle = .warning
    return prompt.runModal() == .alertFirstButtonReturn
  }

  static func confirmTakeOver(_ holder: HostLockRecord) -> Bool {
    let prompt = alert(
      "Quit \(holder.appName) and run Argus Server here?",
      "\(holder.appName) is asked to quit, which stops its running agents, and Argus Server starts its own host on the same Argus home. Paired devices, sessions and the account carry over.",
      buttons: ["Quit and Take Over", "Cancel"])
    return prompt.runModal() == .alertFirstButtonReturn
  }

  static func confirmLoginMigration(oldServerRunning: Bool) -> Bool {
    let prompt = alert(
      "Start Argus Server at login with this app?",
      "The old Argus Server starts at login with a launch agent. Argus Server replaces it with Open at Login, which you can turn off in its menu or in System Settings → Login Items. The old agent is kept in the Argus Server folder."
        + (oldServerRunning ? " The old Argus Server quits now, stopping its running agents." : ""),
      buttons: ["Use Open at Login", "Not Now"])
    return prompt.runModal() == .alertFirstButtonReturn
  }

  enum QuitChoice {
    case quit, quitNow, cancel
  }

  /// Agents get to stop cleanly on Quit; Quit Now doesn't wait for them.
  static func confirmQuit(runningAgents n: Int) -> QuitChoice {
    let prompt = alert(
      n == 1 ? "An agent is still running" : "\(n) agents are still running",
      "Quitting Argus Server stops them. Quit lets them stop cleanly and save first, which can take a few seconds; Quit Now stops them at once.",
      buttons: ["Quit", "Quit Now", "Cancel"])
    switch prompt.runModal() {
    case .alertFirstButtonReturn: return .quit
    case .alertSecondButtonReturn: return .quitNow
    default: return .cancel
    }
  }
}

/// A command that must outlive whatever this app does next.
enum ServerProcess {
  static func detached(_ command: [String]) {
    guard let executable = command.first else { return }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = Array(command.dropFirst())
    try? process.run()
  }
}
