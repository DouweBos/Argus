import AppKit
import ArgusCore

/// Lifecycle the SwiftUI scene can't express: starting the host before any
/// window, and quitting through the host's own shutdown.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let model = DesktopModel()
  private var terminating = false
  private var signalSource: DispatchSourceSignal?

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Another app taking over this Argus home asks us to quit with SIGTERM;
    // treat it as ⌘Q so the host still shuts down cleanly.
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
    source.setEventHandler(handler: Self.terminateFromSignal)
    source.resume()
    signalSource = source

    model.start()
  }

  /// Not from a main-queue block: `terminateLater` waits in a nested run loop,
  /// and the main queue can't drain the shutdown while it is inside one.
  private nonisolated static func terminateFromSignal() {
    let main = CFRunLoopGetMain()
    CFRunLoopPerformBlock(main, CFRunLoopMode.commonModes.rawValue) {
      MainActor.assumeIsolated { NSApp.terminate(nil) }
    }
    CFRunLoopWakeUp(main)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if terminating { return .terminateLater }
    let running = model.runningAgentCount
    if running > 0, !confirmQuit(runningAgents: running) {
      return .terminateCancel
    }
    terminating = true
    Task {
      await model.shutdown()
      NSApp.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }

  /// The Electron app's guard: quitting stops every running agent.
  private func confirmQuit(runningAgents: Int) -> Bool {
    let alert = NSAlert()
    alert.messageText =
      runningAgents == 1 ? "An agent is still running" : "\(runningAgents) agents are still running"
    alert.informativeText = "Quitting Argus stops them."
    alert.addButton(withTitle: "Quit")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
  }
}
