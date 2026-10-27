import ArgusCore
import Foundation

/// The first message of an agent that doesn't exist yet, as a start composer collected it.
public struct ComposerStart: Sendable {
  public let message: String
  public let displayText: String
  public let images: [RemoteImageAttachment]
  /// Nil keeps the starter's default.
  public let permissionMode: RemotePermissionMode?
  /// Picked with `/model`; nil lets the runner choose.
  public let model: String?
}

/// Turns a composer with no agent behind it into a start composer: its
/// permission pill and `/plan`/`/model` set up the agent, and sending starts it.
public struct ComposerStarter {
  /// The mode the agent starts in unless the pill picks another (a raw permission mode).
  public let defaultMode: String
  /// Starts the agent and sends the message; false keeps the draft for another try.
  public let start: @MainActor (ComposerStart) async -> Bool

  public init(defaultMode: String, start: @escaping @MainActor (ComposerStart) async -> Bool) {
    self.defaultMode = defaultMode
    self.start = start
  }

  /// The draft key a session's start composer keeps its text under.
  public static func draftKey(sessionId: String) -> String { "start:\(sessionId)" }
}
