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
  #if DEBUG
    private var devDriver: DevDriver?
  #endif
  private var signalSource: DispatchSourceSignal?

  func applicationDidFinishLaunching(_ notification: Notification) {
    Self.current = self
    FirstMouse.install()
    HistoryInput.install(model)
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

  /// ⌘Q. AppKit refuses `terminate` while a sheet is up (onboarding, any
  /// dialog), so with one up this asks about running agents itself and shuts
  /// down the way the signal path does.
  func quit() {
    guard !terminating else { return }
    // Unsaved code first: Save may need the host, so it runs before anything stops.
    if !model.code.dirtyFiles.isEmpty {
      Task {
        guard await model.confirmUnsavedCode() else { return }
        model.code.discardAllForQuit()
        quit()
      }
      return
    }
    guard NSApp.windows.contains(where: { $0.attachedSheet != nil || ($0.isSheet && $0.isVisible) }) else {
      NSApp.terminate(nil)
      return
    }
    let running = model.runningAgentCount
    if running > 0, !confirmQuit(runningAgents: running) { return }
    terminating = true
    Task {
      await shutdownBounded()
      exit(0)
    }
  }

  /// Not through `NSApp.terminate`: AppKit won't quit while a sheet is up
  /// (onboarding, any dialog), and a signal can't answer one. Shut the host
  /// down the same way ⌘Q does, then exit.
  private nonisolated static func terminateFromSignal() {
    Task { @MainActor in
      guard let delegate = AppDelegate.current, !delegate.terminating else { return }
      delegate.terminating = true
      await delegate.shutdownBounded()
      exit(0)
    }
  }

  /// A host that won't go must not keep the app alive: the supervisor
  /// SIGKILLs it after its own timeout, and this bounds everything else.
  private func shutdownBounded() async {
    await withTaskGroup(of: Void.self) { group in
      group.addTask { await self.model.shutdown() }
      group.addTask { try? await Task.sleep(for: .seconds(25)) }
      await group.next()
      group.cancelAll()
    }
  }

  /// Moved tunnels, new hosts on the account and drives (re)connected, picked up on the way back in.
  func applicationDidBecomeActive(_ notification: Notification) {
    Task { await model.account.refresh() }
    Task { await model.store.refreshHeldLists() }
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    false
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if terminating { return .terminateLater }
    if !model.code.dirtyFiles.isEmpty {
      Task {
        guard await model.confirmUnsavedCode() else { return NSApp.reply(toApplicationShouldTerminate: false) }
        model.code.discardAllForQuit()
        NSApp.reply(toApplicationShouldTerminate: false)
        NSApp.terminate(nil)
      }
      return .terminateLater
    }
    let running = model.runningAgentCount
    if running > 0, !confirmQuit(runningAgents: running) {
      return .terminateCancel
    }
    terminating = true
    Task {
      await shutdownBounded()
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
