#if os(macOS)
  import Foundation

  /// Where an app's bundled host lives, and the `ARGUS_HOME` and gateway port it
  /// runs on: the Mac app's (`~/.argus`) or Argus Server's (`~/.argus-server`).
  ///
  /// A debug build never defaults to a release home: that is the installed
  /// app's live state, and a dev build sharing it would fight it for every
  /// worktree. `ARGUS_HOME` and `ARGUS_REMOTE_PORT` still override.
  public struct HostLocation: Sendable {
    public var mode: HostSupervisor.Mode
    /// Under the user's home directory.
    public var releaseHome: String
    public var debugHome: String
    /// The gateway port when `ARGUS_REMOTE_PORT` is unset; nil leaves it to the host.
    public var releasePort: Int?
    public var debugPort: Int?
    public var isDebug: Bool
    public var environment: [String: String]
    public var userHome: URL
    /// `Bundle.main.resourceURL`.
    public var resources: URL?

    public init(
      mode: HostSupervisor.Mode, releaseHome: String, debugHome: String,
      releasePort: Int? = nil, debugPort: Int? = nil, isDebug: Bool,
      environment: [String: String] = ProcessInfo.processInfo.environment,
      userHome: URL = FileManager.default.homeDirectoryForCurrentUser,
      resources: URL? = Bundle.main.resourceURL
    ) {
      self.mode = mode
      self.releaseHome = releaseHome
      self.debugHome = debugHome
      self.releasePort = releasePort
      self.debugPort = debugPort
      self.isDebug = isDebug
      self.environment = environment
      self.userHome = userHome
      self.resources = resources
    }

    /// The Mac app: `~/.argus`, the gateway port following Settings.
    public static func desktop(isDebug: Bool) -> HostLocation {
      HostLocation(mode: .desktop, releaseHome: ".argus", debugHome: ".argus-mac-dev", isDebug: isDebug)
    }

    /// Argus Server: the Electron server's `~/.argus-server` and 47617, so it
    /// drops in for it. Debug sits apart from every other Argus port.
    public static func server(isDebug: Bool) -> HostLocation {
      HostLocation(
        mode: .server, releaseHome: ".argus-server", debugHome: ".argus-mac-server-dev",
        releasePort: 47617, debugPort: 48116, isDebug: isDebug)
    }

    private func path(_ key: String) -> URL? {
      guard let raw = environment[key], !raw.trimmingCharacters(in: .whitespaces).isEmpty else {
        return nil
      }
      return URL(fileURLWithPath: (raw as NSString).expandingTildeInPath)
    }

    /// `ARGUS_HOME` from the environment, else this build's default.
    public var home: URL {
      path("ARGUS_HOME") ?? userHome.appendingPathComponent(isDebug ? debugHome : releaseHome)
    }

    /// `ARGUS_ATTACH_HOME`: run only as a second window on whatever app holds
    /// that home — never a host there, no lock, no migration. The Mac app only:
    /// a server that runs no host of its own has nothing to serve.
    public var attachHome: URL? {
      mode == .desktop ? path("ARGUS_ATTACH_HOME") : nil
    }

    /// `ARGUS_REMOTE_PORT`, else this build's default.
    public var port: Int? {
      if let raw = environment["ARGUS_REMOTE_PORT"], let port = Int(raw) { return port }
      return isDebug ? debugPort : releasePort
    }

    /// `Contents/Resources/host`, staged by `scripts/build-mac-host.ts`.
    public var bundledHost: URL {
      (resources ?? URL(fileURLWithPath: "/")).appendingPathComponent("host")
    }

    public func configuration(environment extra: [String: String] = [:]) -> HostSupervisor.Configuration {
      let host = bundledHost
      var environment = extra
      if let port, self.environment["ARGUS_REMOTE_PORT"] == nil {
        environment["ARGUS_REMOTE_PORT"] = String(port)
      }
      return .init(
        node: host.appendingPathComponent("node"),
        hostScript: host.appendingPathComponent("argus-host.js"),
        resources: host.appendingPathComponent("resources"),
        home: attachHome ?? home,
        environment: environment,
        attachOnly: attachHome != nil,
        mode: mode)
    }
  }
#endif
