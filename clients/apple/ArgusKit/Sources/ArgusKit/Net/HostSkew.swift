import Foundation

/// A client newer than the host it talks to asks for things the host never had.
/// Recognised here, once, so every caller gets one plain message for it.
extension GatewayErrorPayload {
  /// `UNKNOWN_COMMAND` in `packages/remote-protocol/src/messages.ts`.
  public static let unknownCommandReason = "unknown_command"

  /// The method or command the host doesn't have, if that's what this says.
  /// Hosts from before `data.reason` only send "unknown command|method <name>".
  public var unsupportedMethod: String? {
    if let data = data?.objectValue, data["reason"]?.stringValue == Self.unknownCommandReason {
      return data["method"]?.stringValue ?? ""
    }
    let words = message.split(separator: " ", omittingEmptySubsequences: false)
    guard words.count == 3, words[0] == "unknown", words[1] == "command" || words[1] == "method",
      !words[2].isEmpty
    else { return nil }
    return String(words[2])
  }
}

extension Transport.TransportError: LocalizedError {
  /// The host's own catalog command for its version: admin-tier, so a phone
  /// without admin simply doesn't learn it.
  static let versionCommand = "get_app_version"

  public static func unsupportedMessage(hostVersion: String?) -> String {
    guard let hostVersion, !hostVersion.isEmpty else {
      return "This needs a newer version of Argus than the host you're connected to is running."
    }
    return "This needs a newer version of Argus. The host you're connected to is running \(hostVersion)."
  }

  public var errorDescription: String? {
    guard case .unsupported(_, let hostVersion) = self else { return nil }
    return Self.unsupportedMessage(hostVersion: hostVersion)
  }
}
