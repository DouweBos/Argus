import Foundation

extension RemoteMessageCommand {
  /// What the chip reads: `/compact`.
  public var label: String { "/\(name)" }
}

extension RemoteMessage {
  /// The text under a command's chip — its arguments — or the message's own text otherwise.
  public var bodyBlocks: [String] {
    guard let command else { return displayBlocks }
    return command.args.map { [$0] } ?? []
  }
}
