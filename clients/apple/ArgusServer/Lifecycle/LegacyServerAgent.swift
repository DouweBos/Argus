import Foundation

/// The Electron server's hand-installed launch agent (`pnpm server:install-agent`):
/// `~/Library/LaunchAgents/dev.houwert.argus.server.plist`. Argus Server
/// replaces it with its own login item once, with the user's say-so.
struct LegacyServerAgent {
  static let label = "dev.houwert.argus.server"

  var launchAgents: URL
  var home: URL

  init(
    launchAgents: URL = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent("Library/LaunchAgents"),
    home: URL
  ) {
    self.launchAgents = launchAgents
    self.home = home
  }

  var plist: URL { launchAgents.appendingPathComponent("\(Self.label).plist") }
  /// Kept rather than deleted, so going back to the Electron server is a move.
  var movedPlist: URL { home.appendingPathComponent("migrated/\(Self.label).plist") }

  var isInstalled: Bool { FileManager.default.fileExists(atPath: plist.path) }

  /// Whether this very process is the old agent's job: the plist points at
  /// `Argus Server.app`, which the native app replaced in place.
  static func isRunningUnder(environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
    environment["XPC_SERVICE_NAME"] == label
  }

  /// Move the plist aside so it doesn't load at the next login.
  func moveAside() throws {
    let manager = FileManager.default
    try manager.createDirectory(at: movedPlist.deletingLastPathComponent(), withIntermediateDirectories: true)
    if manager.fileExists(atPath: movedPlist.path) { try manager.removeItem(at: movedPlist) }
    try manager.moveItem(at: plist, to: movedPlist)
  }

  /// Unload the old job. When this process is that job, launchd stops it too,
  /// so callers run it last, detached, after shutting down.
  static func bootoutCommand(uid: uid_t = getuid()) -> [String] {
    ["/bin/launchctl", "bootout", "gui/\(uid)/\(label)"]
  }
}

/// What the first launch should offer, as a pure decision.
enum MigrationPlan: Equatable {
  case none
  /// Ask once whether this app should take over starting at login.
  case offerLoginItem
  /// The user already answered; the menu keeps offering it.
  case menuOnly

  static func decide(oldAgentInstalled: Bool, alreadyAsked: Bool, isDebug: Bool) -> MigrationPlan {
    // A debug build runs on its own home and never touches the real login setup.
    guard oldAgentInstalled, !isDebug else { return .none }
    return alreadyAsked ? .menuOnly : .offerLoginItem
  }
}
