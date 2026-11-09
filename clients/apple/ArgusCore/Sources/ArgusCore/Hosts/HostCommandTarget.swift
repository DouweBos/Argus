import Foundation

/// Where a command runs while it is aimed at a paired host.
///
/// Most commands go to the host — that is the point. The exceptions act on the
/// machine the window is on (opening a link), on this app's own trust store
/// and updater, or on a disk the client doesn't have.
public enum HostCommandTarget: Equatable, Sendable {
  case client
  case host
  case unavailable

  /// Host-only commands with a perfectly good meaning here.
  static let clientExecuted: Set<String> = ["open_external_url"]

  /// Commands that reach into a filesystem the client doesn't have.
  static let unavailableHere: Set<String> = [
    "open_path", "reveal_in_finder", "open_in_editor", "open_in_custom_editor",
  ]

  /// Prefixes that always stay on the client: pairing and gateway config are
  /// this Mac's root of trust, the app updates itself, telemetry is keyed to
  /// this install, and `ui.*` is the local socket's own dialect.
  static let clientPrefixes = ["remote_", "updater_", "telemetry_", "ui."]

  /// `tier` is the catalog's, when the caller knows it; `host`-tier commands
  /// never cross the gateway.
  public static func of(_ command: String, tier: String? = nil) -> HostCommandTarget {
    if unavailableHere.contains(command) { return .unavailable }
    if clientExecuted.contains(command) { return .client }
    if clientPrefixes.contains(where: command.hasPrefix) { return .client }
    if tier == "host" { return .unavailable }
    return .host
  }
}
