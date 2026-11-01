import ArgusCore
import Foundation
import SwiftUI

/// Turns a composer with no agent behind it into a start composer: its
/// pills and `/plan`/`/model` set up the agent, and sending starts it.
public struct ComposerStarter {
  /// The mode the agent starts in unless the pill picks another (a raw permission mode).
  public let defaultMode: String
  /// The model the agent starts on unless the pill picks another; nil is the runner's default.
  public let defaultModel: String?
  /// A new worktree's branch is named from the text, so images alone can't send.
  public let needsText: Bool
  /// False: an empty message still starts (a Linear issue brings its own prompt).
  public let needsContent: Bool
  /// False while the start is missing a choice only the footer can make (an existing branch).
  public let ready: Bool
  /// The empty field's ghost text; nil is the composer's own.
  public let placeholder: String?
  /// Starts the agent and sends the message; false keeps the draft for another try.
  public let start: @MainActor (ComposerStart) async -> Bool

  public init(
    defaultMode: String, defaultModel: String? = nil, needsText: Bool = false, needsContent: Bool = true,
    ready: Bool = true, placeholder: String? = nil, start: @escaping @MainActor (ComposerStart) async -> Bool
  ) {
    self.defaultMode = defaultMode
    self.defaultModel = defaultModel
    self.needsText = needsText
    self.needsContent = needsContent
    self.ready = ready
    self.placeholder = placeholder
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
