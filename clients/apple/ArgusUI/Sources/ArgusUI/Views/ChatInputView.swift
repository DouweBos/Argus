import ArgusCore
import SwiftUI

/// The chat input: send or queue a message, attach images, switch model,
/// Claude account, permission mode and effort, and link other projects.
/// `ComposerModel` holds the logic; each platform renders it.
///
/// Only rendered for a device holding the control grant — the gateway refuses
/// every one of these otherwise.
public struct ChatInputView: View {
  @Environment(HostStore.self) private var host

  let agentId: String
  let sessionId: String?
  let onAffordance: ((ChatInputAffordance) -> Void)?
  /// Set: no agent yet, and sending starts one (Mac only).
  var starter: ComposerStarter?

  /// `onAffordance` reports the input affordances the host can't see (slash
  /// commands, mentions, image paste/drop).
  public init(
    agentId: String, sessionId: String? = nil,
    onAffordance: ((ChatInputAffordance) -> Void)? = nil
  ) {
    self.agentId = agentId
    self.sessionId = sessionId
    self.onAffordance = onAffordance
  }

  #if os(macOS)
    /// A start composer for a session with no agent yet: sending starts one there.
    public init(
      startingIn sessionId: String, starter: ComposerStarter,
      onAffordance: ((ChatInputAffordance) -> Void)? = nil
    ) {
      self.agentId = ComposerStarter.draftKey(sessionId: sessionId)
      self.sessionId = sessionId
      self.onAffordance = onAffordance
      self.starter = starter
    }
  #endif

  public var body: some View {
    // A model per agent: switching agents starts a fresh composer over that agent's draft.
    Group {
      #if os(macOS)
        MacChatInputView(
          host: host, agentId: agentId, sessionId: sessionId, onAffordance: onAffordance, starter: starter)
      #else
        PhoneChatInputView(host: host, agentId: agentId, sessionId: sessionId, onAffordance: onAffordance)
      #endif
    }
    .id(ComposerIdentity(agentId: agentId, sessionId: sessionId))
  }

  /// A stopped agent's last status can still carry the continue it had queued.
  nonisolated static func pendingLimitResume(_ status: RemoteAgentStatus?) -> Double? {
    guard let status, status.status != .stopped, status.status != .error else { return nil }
    return status.limitResumeAt
  }
}

private struct ComposerIdentity: Hashable {
  let agentId: String
  let sessionId: String?
}
