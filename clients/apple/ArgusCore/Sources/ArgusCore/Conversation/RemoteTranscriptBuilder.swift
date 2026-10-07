import Foundation

/// Port of the host's snapshot → wire conversion behind `agents.transcript`
/// (packages/host/src/services/remote/capabilities.ts), so a conversation
/// built locally renders through the same `RemoteMessage` views the phone uses.
///
/// Each function builds the exact JSON the host sends; the typed variants
/// decode that JSON into ArgusKit's models.
public enum RemoteTranscriptBuilder {
  /// Stable image id; `slot` is the owning tool's id, or "msg" for attachments.
  public static func imageId(messageId: String, slot: String, blockIndex: Int) -> String {
    "\(messageId):\(slot):\(blockIndex)"
  }

  // MARK: Messages

  /// Bookkeeping (ToolSearch, blank text) is stripped; a message left empty
  /// is dropped by the page builders here and by `ToolGroups` downstream.
  public static func messageJSON(_ source: ConversationMessage) -> JSONValue {
    let m = TranscriptVisibility.strip(source)
    let messageId = m.id
    var out: [String: JSONValue] = [
      "id": .string(messageId),
      "role": .string(m.role.rawValue),
      "text_blocks": .array(m.textBlocks.filter { !JS.trim($0).isEmpty }.map(JSONValue.string)),
      "tool_calls": .array(m.toolCalls.map { toolCallJSON(messageId: messageId, $0) }),
      "timestamp": .number(m.timestamp),
    ]
    let images = (m.images ?? []).enumerated().map { i, img -> JSONValue in
      .object([
        "image_id": .string(imageId(messageId: messageId, slot: "msg", blockIndex: i)),
        "media_type": .string(img.mediaType),
      ])
    }
    if !images.isEmpty { out["images"] = .array(images) }
    if let source = m.source, source.kind == "mcp", !source.tool.isEmpty {
      out["source"] = .object([
        "kind": .string("mcp"),
        "tool": .string(source.tool),
        "parent_agent_id": source.parentAgentId.map(JSONValue.string) ?? .null,
        "parent_label": source.parentLabel.map(JSONValue.string) ?? .null,
      ])
    }
    if let usage = m.usage, let input = usage["input_tokens"]?.numberValue {
      var u: [String: JSONValue] = [
        "input_tokens": .number(input),
        "output_tokens": usage["output_tokens"].flatMap { $0 == .null ? nil : $0 } ?? .number(0),
      ]
      u["cache_read_input_tokens"] = usage["cache_read_input_tokens"]
      u["cache_creation_input_tokens"] = usage["cache_creation_input_tokens"]
      out["usage"] = .object(u)
    }
    if let author = m.author, !author.isEmpty { out["author"] = .string(author) }
    if let isError = m.isError { out["is_error"] = .bool(isError) }
    return .object(out)
  }

  public static func message(_ m: ConversationMessage) throws -> RemoteMessage {
    try decode(messageJSON(m))
  }

  /// `settled`: the agent is gone, so result-less calls show as interrupted.
  public static func messages(_ conv: AgentConversation, settled: Bool = false) throws
    -> [RemoteMessage]
  {
    try TranscriptVisibility.visibleMessages(conv.messages, settled: settled).map(message)
  }

  static func toolCallJSON(messageId: String, _ tc: ConversationToolCall) -> JSONValue {
    let id = tc.id ?? ""
    var out: [String: JSONValue] = [
      "id": .string(id),
      "name": .string(tc.name ?? "tool"),
      "input": .object(tc.input ?? [:]),
      "result_blocks": .array(resultBlocks(messageId: messageId, toolUseId: id, tc.result)),
      "status": .string(toolStatus(tc)),
    ]
    let children = (tc.children ?? []).map { child -> JSONValue in
      switch child {
      case .text(let t):
        return .object(["kind": .string("text"), "text": .string(t)])
      case .toolUse(let call):
        return .object([
          "kind": .string("tool_use"), "tool_call": toolCallJSON(messageId: messageId, call),
        ])
      }
    }
    if !children.isEmpty { out["children"] = .array(children) }
    if tc.pendingPermission == true { out["pending_permission"] = .bool(true) }
    if tc.isError == true { out["is_error"] = .bool(true) }
    return .object(out)
  }

  static func toolStatus(_ tc: ConversationToolCall) -> String {
    if tc.pendingPermission == true { return "pending" }
    if tc.isError == true { return "error" }
    return tc.result != nil ? "done" : "running"
  }

  /// Result blocks with images swapped for id references — bytes stay on the
  /// snapshot and are fetched through `image(in:id:)`.
  static func resultBlocks(
    messageId: String, toolUseId: String, _ result: ConversationToolResult?
  ) -> [JSONValue] {
    switch result {
    case nil: return []
    case .text(let s)?: return s.isEmpty ? [] : [.object(["type": .string("text"), "text": .string(s)])]
    case .blocks(let blocks)?:
      return blocks.enumerated().map { i, block in
        switch block["type"]?.stringValue {
        case "image":
          var ref: [String: JSONValue] = [
            "type": .string("image"),
            "image_id": .string(imageId(messageId: messageId, slot: toolUseId, blockIndex: i)),
          ]
          ref["media_type"] = block["source"]?["media_type"]
          return .object(ref)
        case "text":
          var text: [String: JSONValue] = ["type": .string("text")]
          text["text"] = block["text"]
          return .object(text)
        default:
          return .object(["type": .string("text"), "text": .string(JS.stringify(block))])
        }
      }
    }
  }

  // MARK: Tasks and todos

  /// Ordered task list, or `.null` when there is none or it was dismissed.
  public static func tasksJSON(_ conv: AgentConversation) -> JSONValue {
    guard let tasks = conv.tasks?.value else { return .null }
    let order = (conv.taskOrder?.isEmpty ?? true) ? tasks.keys.sorted() : conv.taskOrder!
    return .array(
      order.compactMap { id -> JSONValue? in
        guard let t = tasks[id], !t.subject.isEmpty else { return nil }
        var out: [String: JSONValue] = [
          "id": .string(t.id),
          "subject": .string(t.subject),
          "status": .string(t.status.rawValue),
        ]
        out["description"] = t.description.map(JSONValue.string)
        out["activeForm"] = t.activeForm.map(JSONValue.string)
        out["owner"] = t.owner.map(JSONValue.string)
        out["blocks"] = t.blocks.map { .array($0.map(JSONValue.string)) }
        out["blockedBy"] = t.blockedBy.map { .array($0.map(JSONValue.string)) }
        return .object(out)
      })
  }

  /// The todo list with blank entries dropped, or `.null`.
  public static func todosJSON(_ conv: AgentConversation) -> JSONValue {
    guard let todos = conv.todos?.value else { return .null }
    return .array(
      todos.compactMap { t -> JSONValue? in
        guard JS.isTruthy(t["content"]) else { return nil }
        let status = t["status"]?.stringValue
        var out: [String: JSONValue] = [
          "content": t["content"]!,
          "status": .string(status == "completed" || status == "in_progress" ? status! : "pending"),
        ]
        out["activeForm"] = t["activeForm"]
        return .object(out)
      })
  }

  // MARK: Pages

  /// One `agents.transcript` page. `before` → the page ending there, `after` →
  /// forward from there, neither → the tail. Cursors index the raw history;
  /// hidden bookkeeping just thins the page.
  public static func transcriptJSON(
    _ conv: AgentConversation, after: Int? = nil, before: Int? = nil, limit: Int? = nil,
    settled: Bool = false
  ) -> JSONValue {
    let total = conv.messages.count
    let size = limit ?? 100
    let start: Int
    let end: Int
    if let before {
      end = min(before, total)
      start = max(0, end - size)
    } else if let after {
      start = after
      end = min(total, start + size)
    } else {
      start = max(0, total - size)
      end = total
    }
    let page =
      start < end
      ? TranscriptVisibility.visibleMessages(Array(conv.messages[start..<end]), settled: settled)
      : []
    return .object([
      "messages": .array(page.map(messageJSON)),
      "next_after": end < total ? .number(Double(end)) : .null,
      "prev_before": start > 0 ? .number(Double(start)) : .null,
      "total": .number(Double(total)),
      "tasks": tasksJSON(conv),
      "todos": todosJSON(conv),
      "model": conv.model.map(JSONValue.string) ?? .null,
      "pending_tool_name": conv.pendingToolName?.value.map(JSONValue.string) ?? .null,
    ])
  }

  public static func transcript(
    _ conv: AgentConversation, after: Int? = nil, before: Int? = nil, limit: Int? = nil,
    settled: Bool = false
  ) throws -> RemoteTranscript {
    try decode(transcriptJSON(conv, after: after, before: before, limit: limit, settled: settled))
  }

  // MARK: Images

  /// Resolves an id minted above back to its bytes (`agents.image`).
  public static func image(in conv: AgentConversation, id wanted: String) -> ConversationImage? {
    func walk(_ messageId: String, _ tc: ConversationToolCall) -> ConversationImage? {
      let id = tc.id ?? ""
      var found: ConversationImage?
      if case .blocks(let blocks)? = tc.result {
        for (i, block) in blocks.enumerated()
        where block["type"]?.stringValue == "image"
          && imageId(messageId: messageId, slot: id, blockIndex: i) == wanted
        {
          found = ConversationImage(
            data: block["source"]?["data"]?.stringValue ?? "",
            mediaType: block["source"]?["media_type"]?.stringValue ?? "")
        }
      }
      if found == nil {
        for child in tc.children ?? [] {
          if case .toolUse(let call) = child, let hit = walk(messageId, call) { return hit }
        }
      }
      return found
    }

    for m in conv.messages {
      for (i, img) in (m.images ?? []).enumerated()
      where imageId(messageId: m.id, slot: "msg", blockIndex: i) == wanted {
        return img
      }
      for tc in m.toolCalls {
        if let hit = walk(m.id, tc) { return hit }
      }
    }
    return nil
  }

  static func decode<T: Decodable>(_ value: JSONValue) throws -> T {
    try JSONDecoder().decode(T.self, from: JSONEncoder().encode(value))
  }
}

extension AgentConversation {
  /// The whole conversation as the phone's transcript rows.
  public func remoteMessages() throws -> [RemoteMessage] {
    try RemoteTranscriptBuilder.messages(self)
  }
}
