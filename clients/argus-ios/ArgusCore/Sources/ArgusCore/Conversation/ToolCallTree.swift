import Foundation

// Port of `updateToolCallTree` / `updateToolCallInMessages`. Ids are optional
// on both sides because JS matches `undefined === undefined` too.
enum ToolCallTree {
  static func update(
    _ tc: ConversationToolCall, id: String?, _ updater: (ConversationToolCall) -> ConversationToolCall
  ) -> ConversationToolCall? {
    if tc.id == id { return updater(tc) }
    guard let children = tc.children, !children.isEmpty else { return nil }
    var changed = false
    let next = children.map { child -> ConversationToolCallChild in
      guard case .toolUse(let call) = child, let updated = update(call, id: id, updater) else {
        return child
      }
      changed = true
      return .toolUse(updated)
    }
    guard changed else { return nil }
    var copy = tc
    copy.children = next
    return copy
  }

  /// Updates the call in the newest message holding it; nil when no message does.
  static func update(
    in messages: [ConversationMessage], id: String?,
    _ updater: (ConversationToolCall) -> ConversationToolCall
  ) -> [ConversationMessage]? {
    for i in messages.indices.reversed() {
      var changed = false
      let calls = messages[i].toolCalls.map { tc -> ConversationToolCall in
        guard let updated = update(tc, id: id, updater) else { return tc }
        changed = true
        return updated
      }
      if changed {
        var next = messages
        next[i].toolCalls = calls
        return next
      }
    }
    return nil
  }
}
