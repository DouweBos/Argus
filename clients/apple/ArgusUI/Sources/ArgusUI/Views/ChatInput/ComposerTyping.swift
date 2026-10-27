import SwiftUI

extension EnvironmentValues {
  /// Told `(agentId, typing)` as the composer's text changes and when it's
  /// sent or cleared, so a shared agent's huddle sees the host composing.
  @Entry public var composerTyping: ComposerTyping?

  /// Bumped to put the caret in the Mac composer, as ⌘L does on the desktop.
  @Entry public var composerFocusRequest = 0
}

/// The composer-typing callback. Always equal, so a new closure on each
/// render doesn't invalidate every view reading it.
public struct ComposerTyping: Equatable {
  let call: (String, Bool) -> Void

  public init(_ call: @escaping (String, Bool) -> Void) {
    self.call = call
  }

  public func callAsFunction(_ agentId: String, _ typing: Bool) { call(agentId, typing) }

  public static func == (_: Self, _: Self) -> Bool { true }
}
