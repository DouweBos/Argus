import Foundation

// Port of `appendEvent`: folds one Claude Code stream-json event (the payload
// of `agent:event:<id>`). Shapes the renderer would throw on leave the
// conversation untouched, as the throw aborts its store update.
extension ConversationReducer {
  /// Feeds the raw `agent:event:<id>` payload string. Malformed JSON is
  /// ignored, as the renderer does; returns whether it parsed.
  @discardableResult
  public mutating func appendEvent(json: String) -> Bool {
    guard let event = JS.parse(json) else { return false }
    appendEvent(event)
    return true
  }

  public mutating func appendEvent(_ event: JSONValue) {
    if let next = reduce(existing, event) { conversation = next }
  }

  /// The next conversation, or nil when the event changes nothing.
  private func reduce(_ existing: AgentConversation, _ event: JSONValue) -> AgentConversation? {
    let type = event["type"]?.stringValue
    let subtype = event["subtype"]?.stringValue
    var conv = existing

    // A --resume replays the last turn: drop it, let system events through to
    // refresh metadata, and stop dropping at the first result.
    if existing.resuming == true {
      if type == "result" {
        conv.contextWindow = reportedContextWindow(event, existing)
        conv.resuming = false
        return conv
      }
      if type != "system" { return nil }
    }

    switch (type, subtype) {
    case ("system", "init"):
      return reduceInit(conv, event)

    case ("system", "session_state_changed"):
      conv.lastEventType = "system:session_state_changed:\(JS.interpolate(event["state"]))"
      return conv

    case ("system", "api_retry"):
      let delay = (event["retry_delay_ms"]?.numberValue ?? .nan) / 1000
      let http = JS.isTruthy(event["error_status"])
        ? " (HTTP \(JS.interpolate(event["error_status"])))" : ""
      let text =
        "API retry \(JS.interpolate(event["attempt"]))/\(JS.interpolate(event["max_retries"]))"
        + http + " — retrying in \(JS.number((delay + 0.5).rounded(.down)))s"
      conv.lastEventType = "system:api_retry"
      conv.messages.append(
        ConversationMessage(
          id: environment.makeId(), role: .system, textBlocks: [text],
          timestamp: environment.now()))
      return conv

    case ("assistant", _):
      return reduceAssistant(conv, event)

    case ("user", _):
      return reduceUser(conv, event)

    case ("result", _):
      conv.lastEventType = "result"
      conv.pendingToolName = .null
      conv.pendingToolInput = .null
      conv.contextWindow = reportedContextWindow(event, existing)
      conv.totalCost = (existing.totalCost ?? 0) + (event["total_cost_usd"]?.numberValue ?? 0)
      conv.totalDuration = (existing.totalDuration ?? 0) + (event["duration_ms"]?.numberValue ?? 0)
      return conv

    default:
      return nil
    }
  }

  private func reduceInit(_ existing: AgentConversation, _ event: JSONValue) -> AgentConversation? {
    guard let tools = event["tools"]?.arrayValue else { return nil }
    var conv = existing

    // Keeps richer commands from initialize; adds bare names it lacks.
    var commands = existing.slashCommands ?? []
    var index: [String: Int] = [:]
    for (i, c) in commands.enumerated() {
      if let name = c["name"]?.stringValue, index[name] == nil { index[name] = i }
    }
    let names = (event["slash_commands"]?.arrayValue ?? []) + (event["skills"]?.arrayValue ?? [])
    for case .string(let name) in names where index[name] == nil {
      index[name] = commands.count
      commands.append(.object(["name": .string(name), "description": .string(""), "argumentHint": .string("")]))
    }

    conv.lastEventType = "system"
    conv.model = event["model"]?.stringValue
    conv.sessionId = event["session_id"]?.stringValue
    conv.tools = tools.compactMap { $0["name"]?.stringValue }
    conv.slashCommands = commands
    return conv
  }

  private func reduceAssistant(_ existing: AgentConversation, _ event: JSONValue) -> AgentConversation? {
    guard case .object(let message)? = event["message"] else { return nil }
    let content: [JSONValue]
    switch message["content"] {
    case nil, .null?: content = []
    case .array(let blocks)?: content = blocks
    // `for…of` over a string yields characters, none of them a block.
    case .string?: content = []
    default: return nil
    }
    var conv = existing

    // Sub-agent output nests under its parent Task/Agent call.
    if JS.isTruthy(event["parent_tool_use_id"]) {
      // `content.map` throws on a string.
      if case .string? = message["content"] { return nil }
      let parentId = event["parent_tool_use_id"]?.stringValue
      // Every non-text block becomes a tool_use child — `thinking` included.
      let children = content.map { block -> ConversationToolCallChild in
        if block["type"]?.stringValue == "text" {
          return .text(block["text"]?.stringValue ?? "")
        }
        return .toolUse(
          ConversationToolCall(
            id: block["id"]?.stringValue, name: block["name"]?.stringValue,
            input: block["input"]?.objectValue))
      }
      guard
        let messages = ToolCallTree.update(in: existing.messages, id: parentId, { tc in
          var next = tc
          next.children = (tc.children ?? []) + children
          return next
        })
      else { return nil }
      conv.lastEventType = "assistant"
      conv.messages = messages
      return conv
    }

    var textBlocks: [String] = []
    var toolCalls: [ConversationToolCall] = []
    for block in content {
      switch block["type"]?.stringValue {
      case "text":
        if let text = block["text"]?.stringValue { textBlocks.append(text) }
      case "tool_use":
        toolCalls.append(
          ConversationToolCall(
            id: block["id"]?.stringValue, name: block["name"]?.stringValue,
            input: block["input"]?.objectValue))
      default:
        break
      }
    }

    let msg = ConversationMessage(
      id: environment.makeId(), role: .assistant, textBlocks: textBlocks, toolCalls: toolCalls,
      timestamp: environment.now(), usage: message["usage"])
    let lastTool = toolCalls.last

    conv.lastEventType = "assistant"
    conv.model = existing.model ?? message["model"]?.stringValue
    conv.messages.append(msg)
    conv.pendingToolName = lastTool?.name.map { .value($0) } ?? .null
    conv.pendingToolInput = lastTool?.input.map { .object($0) } ?? .null
    // The latest TodoWrite wins.
    if let todos = ConversationTasks.extractTodos(toolCalls) { conv.todos = .value(todos) }
    return conv
  }

  private func reduceUser(_ existing: AgentConversation, _ event: JSONValue) -> AgentConversation? {
    guard case .object(let message)? = event["message"] else { return nil }
    // Each element is matched by `tool_use_id`; iterating a string yields
    // characters, which carry none.
    let results: [JSONValue]
    switch message["content"] {
    case nil, .null?: results = []
    case .array(let items)?: results = items
    case .string(let s)?: results = Array(repeating: .string(""), count: s.unicodeScalars.count)
    default: return nil
    }
    if results.isEmpty { return nil }
    if results.contains(.null) { return nil }

    let isSubAgent = JS.isTruthy(event["parent_tool_use_id"])
    var messages = existing.messages
    var changed = false
    var taskCalls: [ConversationToolCall] = []
    // Matched across the whole history: a background Agent's result lands
    // many turns after its call.
    for match in results {
      let next = ToolCallTree.update(in: messages, id: match["tool_use_id"]?.stringValue) { tc in
        // AskUserQuestion and ExitPlanMode answer through a deny, which the
        // CLI flags as an error; to the user it's a successful answer.
        let isDenyAnswerFlow = tc.name == "AskUserQuestion" || tc.name == "ExitPlanMode"
        var nextTc = tc
        nextTc.result = toToolResult(match["content"])
        nextTc.isError = isDenyAnswerFlow ? false : (match["is_error"]?.boolValue ?? false)
        if let name = nextTc.name, ConversationTasks.taskToolNames.contains(name) {
          taskCalls.append(nextTc)
        }
        return nextTc
      }
      if let next {
        messages = next
        changed = true
      }
    }
    if isSubAgent && !changed { return nil }

    let update = ConversationTasks.applyLive(
      tasks: existing.tasks?.value, order: existing.taskOrder, calls: taskCalls, messages: messages)
    var conv = existing
    conv.lastEventType = "user"
    conv.messages = messages
    if !isSubAgent {
      conv.pendingToolName = .null
      conv.pendingToolInput = .null
    }
    conv.taskOrder = update?.order ?? existing.taskOrder
    conv.tasks = update.map { .value($0.tasks) } ?? existing.tasks ?? .null
    return conv
  }

  private func reportedContextWindow(_ event: JSONValue, _ existing: AgentConversation) -> Double? {
    contextWindow(fromModelUsage: event["modelUsage"], mainModel: existing.model)
      ?? existing.contextWindow
  }
}

/// `contextWindowFromModelUsage`: the main model's window, else the largest.
func contextWindow(fromModelUsage modelUsage: JSONValue?, mainModel: String?) -> Double? {
  guard case .object(let usage)? = modelUsage else { return nil }
  var windows: [String: Double] = [:]
  for (model, entry) in usage {
    if let size = entry["contextWindow"]?.numberValue, size > 0 { windows[model] = size }
  }
  guard let largest = windows.values.max() else { return nil }
  if let mainModel, !mainModel.isEmpty, let main = windows[mainModel] { return main }
  return largest
}

/// `toToolResult`: strings stay strings, block arrays keep text and images
/// (`tool_reference` names join into one text block), anything else becomes
/// pretty-printed JSON. Missing content stays missing.
func toToolResult(_ raw: JSONValue?) -> ConversationToolResult? {
  switch raw {
  case nil: return nil
  case .string(let s)?: return .text(s)
  case .array(let items)?:
    var blocks: [JSONValue] = []
    var toolNames: [String] = []
    for block in items {
      if block["type"]?.stringValue == "image" {
        blocks.append(block)
      } else if block["type"]?.stringValue == "tool_reference" {
        if let name = block["tool_name"]?.stringValue { toolNames.append(name) }
      } else if let text = block["text"]?.stringValue {
        blocks.append(.object(["type": .string("text"), "text": .string(text)]))
      }
    }
    if !toolNames.isEmpty {
      blocks.append(.object(["type": .string("text"), "text": .string(toolNames.joined(separator: "\n"))]))
    }
    return .blocks(blocks)
  case let other?:
    return .text(JS.stringify(other, indent: 2))
  }
}
