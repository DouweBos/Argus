import Foundation

/// Port of `visibility.ts`: what a transcript shows. Thinking-only turns,
/// ToolSearch loading deferred tools and synthetic "No response requested."
/// stubs are bookkeeping that would otherwise render as blank rows or empty
/// tool cards.
public enum TranscriptVisibility {
  /// Tools that manage the agent's own context rather than do any work.
  static let metaToolNames: Set<String> = ["ToolSearch"]
  /// Text the CLI synthesises when a turn ends without a model response.
  static let metaTexts: Set<String> = ["No response requested."]
  /// The result a call that will never get one shows instead.
  public static let interruptedResult = "Interrupted"

  public static func isMetaText(_ text: String) -> Bool {
    let trimmed = JS.trim(text)
    return trimmed.isEmpty || metaTexts.contains(trimmed)
  }

  /// Context bookkeeping, or a nameless block (a sub-agent's thinking).
  public static func isMetaToolCall(_ tc: ConversationToolCall) -> Bool {
    if tc.pendingPermission == true { return false }
    guard let name = tc.name, !name.isEmpty else { return true }
    return metaToolNames.contains(name)
  }

  /// The call as shown, or nil when it is bookkeeping. `settled`: the agent is
  /// gone, so a call without a result never gets one.
  public static func visibleToolCall(_ tc: ConversationToolCall, settled: Bool = false)
    -> ConversationToolCall?
  {
    if isMetaToolCall(tc) { return nil }
    var next = tc
    if let children = tc.children {
      next.children = children.compactMap { child -> ConversationToolCallChild? in
        switch child {
        case .text(let text): return isMetaText(text) ? nil : child
        case .toolUse(let call): return visibleToolCall(call, settled: settled).map { .toolUse($0) }
        }
      }
    }
    if settled, tc.result == nil, tc.pendingPermission != true {
      next.result = .text(interruptedResult)
      next.isError = true
    }
    return next
  }

  /// The message as shown, or nil when nothing in it is.
  public static func visibleMessage(_ m: ConversationMessage, settled: Bool = false)
    -> ConversationMessage?
  {
    let stripped = strip(m, settled: settled)
    let hasContent =
      stripped.textBlocks.contains { !JS.trim($0).isEmpty }
      || !stripped.toolCalls.isEmpty
      || !(stripped.images ?? []).isEmpty
      || stripped.isError == true
    return hasContent ? stripped : nil
  }

  /// The message with its bookkeeping removed, kept even when nothing is left.
  public static func strip(_ m: ConversationMessage, settled: Bool = false) -> ConversationMessage {
    var next = m
    if m.role != .user { next.textBlocks = m.textBlocks.filter { !isMetaText($0) } }
    next.toolCalls = m.toolCalls.compactMap { visibleToolCall($0, settled: settled) }
    return next
  }

  public static func visibleMessages(_ messages: [ConversationMessage], settled: Bool = false)
    -> [ConversationMessage]
  {
    messages.compactMap { visibleMessage($0, settled: settled) }
  }
}
