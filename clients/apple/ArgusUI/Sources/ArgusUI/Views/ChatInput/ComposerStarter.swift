import ArgusCore
import Foundation
import SwiftUI

/// The first message of an agent that doesn't exist yet, as a start composer collected it.
public struct ComposerStart: Sendable {
  public let message: String
  public let displayText: String
  public let images: [RemoteImageAttachment]
  /// Nil keeps the starter's default.
  public let permissionMode: RemotePermissionMode?
  /// Picked in the model pill or with `/model`; nil lets the runner choose.
  public let model: String?
  /// Picked in the effort pill; nil keeps the model's default.
  public let effort: String?
}

/// Turns a composer with no agent behind it into a start composer: its
/// pills and `/plan`/`/model` set up the agent, and sending starts it.
public struct ComposerStarter {
  /// The mode the agent starts in unless the pill picks another (a raw permission mode).
  public let defaultMode: String
  /// The model the agent starts on unless the pill picks another; nil is the runner's default.
  public let defaultModel: String?
  /// A new worktree's branch is named from the text, so images alone can't send.
  public let needsText: Bool
  /// Starts the agent and sends the message; false keeps the draft for another try.
  public let start: @MainActor (ComposerStart) async -> Bool

  public init(
    defaultMode: String, defaultModel: String? = nil, needsText: Bool = false,
    start: @escaping @MainActor (ComposerStart) async -> Bool
  ) {
    self.defaultMode = defaultMode
    self.defaultModel = defaultModel
    self.needsText = needsText
    self.start = start
  }

  /// The draft key a session's start composer keeps its text under.
  public static func draftKey(sessionId: String) -> String { "start:\(sessionId)" }
}

extension EnvironmentValues {
  /// Set: sending starts an agent here instead (a new worktree), even from a fresh agent's composer.
  @Entry public var composerRedirect: ComposerStarter?
  /// A strip attached under the composer's box, e.g. where the agent will work.
  @Entry public var composerFooter: AnyView?
}
