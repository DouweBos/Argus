import AppKit
import ArgusCore

/// Lifecycle the SwiftUI scene can't express: starting the host before any
/// window, and quitting through the host's own shutdown.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  let model = DesktopModel()
  /// SwiftUI owns the delegate; a signal handler needs a way back to it.
  private(set) static weak var current: AppDelegate?
  private(set) var terminating = false
  var skipQuitConfirmation = false
  #if DEBUG
    private var devDriver: DevDriver?
  #endif
  private var signalSource: DispatchSourceSignal?

  func applicationDidFinishLaunching(_ notification: Notification) {
    Self.current = self
    // Unit tests run inside the app; they must not start a host.
    if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil { return }
    // Another app taking over this Argus home asks us to quit with SIGTERM;
    // treat it as ⌘Q so the host still shuts down cleanly.
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
    source.setEventHandler(handler: Self.terminateFromSignal)
    source.resume()
    signalSource = source

    model.start()
    #if DEBUG
      devDriver = DevDriver.startIfConfigured()
    #endif
  }

  /// Not from a main-queue block: `terminateLater` waits in a nested run loop,
  /// and the main queue can't drain the shutdown while it is inside one.
  private nonisolated static func terminateFromSignal() {
    let main = CFRunLoopGetMain()
    CFRunLoopPerformBlock(main, CFRunLoopMode.commonModes.rawValue) {
      MainActor.assumeIsolated {
        guard let delegate = AppDelegate.current, !delegate.terminating else { return }
        // Whoever sent it (another Argus taking over) already asked the user.
        delegate.skipQuitConfirmation = true
        // An open sheet makes AppKit refuse to quit and bring the app forward
        // to show it instead; a signal can't answer the sheet, so close it
        // and quit once it's gone.
        delegate.model.newSessionProject = nil
        delegate.model.deletingSession = nil
        let timer = Timer(timeInterval: 0.3, repeats: false) { _ in
          MainActor.assumeIsolated { NSApp.terminate(nil) }
        }
        RunLoop.main.add(timer, forMode: .common)
      }
    }
    CFRunLoopWakeUp(main)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if terminating { return .terminateLater }
    let running = model.runningAgentCount
    if running > 0, !skipQuitConfirmation, !confirmQuit(runningAgents: running) {
      return .terminateCancel
    }
    terminating = true
    Task {
      // A host that won't go must not keep the app alive: the supervisor
      // SIGKILLs it after its own timeout, and this bounds everything else.
      await withTaskGroup(of: Void.self) { group in
        group.addTask { await self.model.shutdown() }
        group.addTask { try? await Task.sleep(for: .seconds(25)) }
        await group.next()
        group.cancelAll()
      }
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
