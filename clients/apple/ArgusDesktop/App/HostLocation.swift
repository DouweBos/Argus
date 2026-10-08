import ArgusCore
import Foundation

/// Where the bundled host lives and which `ARGUS_HOME` it runs on.
enum HostLocation {
  /// `ARGUS_HOME` from the environment, else the desktop's `~/.argus`.
  ///
  /// A debug build never defaults to `~/.argus`: that is the installed app's
  /// live state, and a dev build sharing it would fight it for every worktree.
  static var home: URL {
    if let override = ProcessInfo.processInfo.environment["ARGUS_HOME"],
      !override.trimmingCharacters(in: .whitespaces).isEmpty
    {
      return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
    }
    let home = FileManager.default.homeDirectoryForCurrentUser
    #if DEBUG
      return home.appendingPathComponent(".argus-mac-dev")
    #else
      return home.appendingPathComponent(".argus")
    #endif
  }

  /// `ARGUS_ATTACH_HOME`: run only as a second window on whatever app holds
  /// that home — never a host there, no lock, no migration. How a debug build
  /// opens next to the Argus you use (`ARGUS_ATTACH_HOME=~/.argus`) while its
  /// own state stays in `home`.
  static var attachHome: URL? {
    guard let raw = ProcessInfo.processInfo.environment["ARGUS_ATTACH_HOME"],
      !raw.trimmingCharacters(in: .whitespaces).isEmpty
    else { return nil }
    return URL(fileURLWithPath: (raw as NSString).expandingTildeInPath)
  }

  /// `Contents/Resources/host`, staged by `scripts/build-mac-host.ts`.
  static var bundledHost: URL {
    Bundle.main.resourceURL!.appendingPathComponent("host")
  }

  static func configuration() -> HostSupervisor.Configuration {
    let host = bundledHost
    return .init(
      node: host.appendingPathComponent("node"),
      hostScript: host.appendingPathComponent("argus-host.js"),
      resources: host.appendingPathComponent("resources"),
      home: attachHome ?? home,
      attachOnly: attachHome != nil)
  }
}
