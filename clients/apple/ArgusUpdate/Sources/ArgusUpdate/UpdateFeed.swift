import Foundation

/// The release channels, as the Electron updater names its feeds.
public enum UpdateChannel: String, CaseIterable, Sendable {
  case latest, beta, alpha

  /// `updater_channel` as `app-settings.json` stores it; anything else is `latest`.
  public init(setting: String?) {
    self = setting.flatMap(UpdateChannel.init(rawValue:)) ?? .latest
  }

  public var label: String {
    switch self {
    case .latest: "Stable"
    case .beta: "Beta"
    case .alpha: "Alpha"
    }
  }
}

/// Where an app's Sparkle appcast lives: next to the release assets, through
/// the houwert.dev proxy that reads them off the (private) GitHub releases.
public struct UpdateFeed: Sendable, Equatable {
  /// `argus-mac` or `argus-server`: one appcast per product and channel.
  public var product: String
  public var channel: UpdateChannel

  public static let base = URL(string: "https://houwert.dev/argus/updates/")!

  public init(product: String, channel: UpdateChannel) {
    self.product = product
    self.channel = channel
  }

  public var url: URL {
    Self.base.appendingPathComponent("\(product)-\(channel.rawValue).xml")
  }
}

/// Where an update stands, in the handful of things a menu can say. Mirrors
/// the Electron server's `ServerUpdateState`.
public enum UpdateState: Equatable, Sendable {
  /// This build has no update key: it can't verify an update, so it never looks.
  case unavailable
  case idle
  case checking
  case upToDate
  case available(version: String)
  case downloading(percent: Int)
  /// Downloaded and unpacked; waiting for the restart.
  case ready(version: String)
  case installing
  case failed(String)
}

/// Whether restarting into an update is safe right now. Agents die with the
/// host, and a server exists so agents keep running while nobody watches.
public enum InstallVerdict: Equatable, Sendable {
  case ok
  case notReady
  case agentsRunning(Int)

  public init(state: UpdateState, activeAgents: Int) {
    guard case .ready = state else {
      self = .notReady
      return
    }
    self = activeAgents > 0 ? .agentsRunning(activeAgents) : .ok
  }
}
