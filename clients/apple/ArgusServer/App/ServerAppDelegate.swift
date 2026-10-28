import AppKit
import ArgusCore

/// Lifecycle the scenes can't express: one instance, the host up before any
/// menu opens, and quitting through the host's own shutdown.
@MainActor
final class ServerAppDelegate: NSObject, NSApplicationDelegate {
  let model = ServerModel()
  private(set) var terminating = false
  private var signalSource: DispatchSourceSignal?

  static var isTesting: Bool {
    ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Unit tests run inside the app; they must not start a host.
    guard !Self.isTesting else { return }
    model.onQuit = { [weak self] in self?.quit() }
    let home = model.location.home
    Task {
      // A login item and a double-click must not both run a server. Debug
      // builds run one per worktree home; the host lock keeps those apart.
      guard ServerModel.isDebug || (await SingleInstance.waitUntilAlone(home: home)) else {
        exit(0)
      }
      begin()
    }
  }

  private func begin() {
    // Another app taking over this home asks us to quit with SIGTERM.
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    source.setEventHandler { [weak self] in
      Task { @MainActor in self?.quit(force: true) }
    }
    source.resume()
    signalSource = source
    model.notifier.install()
    model.start()
    offerLoginMigrationOnce()
  }

  /// The old server's launch agent: asked about once, then left to the menu.
  private func offerLoginMigrationOnce() {
    let key = "askedToReplaceLaunchAgent"
    let plan = MigrationPlan.decide(
      oldAgentInstalled: model.legacyAgent.isInstalled,
      alreadyAsked: UserDefaults.standard.bool(forKey: key), isDebug: ServerModel.isDebug)
    guard plan == .offerLoginItem else { return }
    UserDefaults.standard.set(true, forKey: key)
    model.offerLoginMigration()
  }

  /// The menu's Quit. Running agents get to stop cleanly unless the user picks
  /// Quit Now; a signal (`force`) skips the question.
  func quit(force: Bool = false) {
    guard !terminating else { return }
    var timeout: Duration = .seconds(15)
    if !force, model.activeAgents > 0 {
      switch ServerPrompts.confirmQuit(runningAgents: model.activeAgents) {
      case .cancel: return
      case .quitNow: timeout = .seconds(2)
      case .quit: break
      }
    }
    terminating = true
    Task {
      await model.shutdown(timeout: timeout)
      // Exit 0: the login item's launchd job restarts only after a crash.
      exit(0)
    }
  }

  /// Sparkle's relaunch and logout come through here: the update guard already
  /// refused while agents ran, so this only has to stop the host.
  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    if terminating || Self.isTesting { return .terminateNow }
    terminating = true
    Task {
      await model.shutdown()
      NSApp.reply(toApplicationShouldTerminate: true)
    }
    return .terminateLater
  }
}

/// One Argus Server per Mac user.
enum SingleInstance {
  /// Waits briefly for another copy that's on its way out (an update's
  /// relaunch, a quick quit and reopen); false while one stays running.
  static func waitUntilAlone(home: URL, timeout: Duration = .seconds(10)) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while !others(home: home).isEmpty {
      if ContinuousClock.now >= deadline { return false }
      try? await Task.sleep(for: .milliseconds(250))
    }
    return true
  }

  /// The old Electron server shares the bundle id; it's not another copy of
  /// this app but the host the menu offers to take over from.
  static func others(home: URL) -> [NSRunningApplication] {
    guard let id = Bundle.main.bundleIdentifier else { return [] }
    let me = ProcessInfo.processInfo.processIdentifier
    let holder = HostLock.read(home: home)
    let oldServer = holder?.owner == .electron ? holder?.ownerPid : nil
    return NSRunningApplication.runningApplications(withBundleIdentifier: id).filter {
      $0.processIdentifier != me && !$0.isTerminated && $0.processIdentifier != oldServer
    }
  }
}
