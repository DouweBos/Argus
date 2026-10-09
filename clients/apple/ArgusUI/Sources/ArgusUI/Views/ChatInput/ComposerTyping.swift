import SwiftUI

extension EnvironmentValues {
  /// Told `(agentId, typing)` as the composer's text changes and when it's
  /// sent or cleared, so a shared agent's huddle sees the host composing.
  @Entry public var composerTyping: ((String, Bool) -> Void)?

  /// Bumped to put the caret in the Mac composer, as ⌘L does on the desktop.
  @Entry public var composerFocusRequest = 0
}
