import Foundation

// Port of the store's TodoWrite and Task* folding.
enum ConversationTasks {
  static let taskToolNames: Set<String> = ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]

  // MARK: Todos

  static func extractTodos(_ calls: [ConversationToolCall]) -> [JSONValue]? {
    for tc in calls.reversed() where tc.name == "TodoWrite" {
      if case .array(let todos)? = tc.input?["todos"] { return todos }
    }
    return nil
  }

  static func latestTodos(in messages: [ConversationMessage]) -> [JSONValue]? {
    for m in messages.reversed() {
      if let todos = extractTodos(m.toolCalls) { return todos }
    }
    return nil
  }

  // MARK: Tasks

  /// The keys a JS object spread would override in `upsertTask`. A key the
  /// source object holds as `undefined` still clears the existing value.
  struct Keys: OptionSet {
    let rawValue: Int
    static let base = Keys(rawValue: 1)  // id, subject, status, description, activeForm
    static let owner = Keys(rawValue: 2)
    static let links = Keys(rawValue: 4)  // blocks, blockedBy
    static let metadata = Keys(rawValue: 8)
    static let all: Keys = [.base, .owner, .links, .metadata]
  }

  struct Patch {
    var task: ConversationTask
    var keys: Keys
  }

  struct State {
    var tasks: [String: ConversationTask]
    var order: [String]

    mutating func upsert(_ patch: Patch) {
      let id = patch.task.id
      guard var merged = tasks[id] else {
        order.append(id)
        tasks[id] = patch.task
        return
      }
      let t = patch.task
      if patch.keys.contains(.base) {
        merged.id = t.id
        merged.subject = t.subject
        merged.status = t.status
        merged.description = t.description
        merged.activeForm = t.activeForm
      }
      if patch.keys.contains(.owner) { merged.owner = t.owner }
      if patch.keys.contains(.links) {
        merged.blocks = t.blocks
        merged.blockedBy = t.blockedBy
      }
      if patch.keys.contains(.metadata) { merged.metadata = t.metadata }
      tasks[id] = merged
    }

    mutating func delete(_ id: String) {
      if tasks.removeValue(forKey: id) != nil, let i = order.firstIndex(of: id) {
        order.remove(at: i)
      }
    }
  }

  static func resultText(_ result: ConversationToolResult?) -> String? {
    switch result {
    case nil: return nil
    case .text(let s)?: return s.isEmpty ? nil : s
    case .blocks(let blocks)?:
      var parts: [String] = []
      for block in blocks where block["type"]?.stringValue == "text" {
        parts.append(block["text"]?.stringValue ?? "")
      }
      return parts.isEmpty ? nil : parts.joined(separator: "\n")
    }
  }

  private static func parsedResult(_ tc: ConversationToolCall) -> JSONValue? {
    resultText(tc.result).flatMap(JS.parse)
  }

  /// `coerceStatus`: nil for anything unrecognised.
  private enum Status { case known(ConversationTaskStatus), deleted }

  private static func coerceStatus(_ raw: JSONValue?) -> Status? {
    switch raw?.stringValue {
    case "completed": return .known(.completed)
    case "in_progress": return .known(.inProgress)
    case "pending": return .known(.pending)
    case "deleted": return .deleted
    default: return nil
    }
  }

  private static func strings(_ v: JSONValue?) -> [String]? {
    v?.arrayValue.map { $0.compactMap(\.stringValue) }
  }

  private static func nonEmptyString(_ v: JSONValue?) -> String? {
    guard let s = v?.stringValue, !s.isEmpty else { return nil }
    return s
  }

  static func coerceTask(_ raw: JSONValue?) -> ConversationTask? {
    guard case .object(let r)? = raw,
      let id = nonEmptyString(r["id"]), let subject = nonEmptyString(r["subject"])
    else { return nil }
    let status: ConversationTaskStatus
    switch coerceStatus(r["status"]) {
    case .deleted?: return nil
    case .known(let s)?: status = s
    case nil: status = .pending
    }
    var metadata: JSONValue?
    switch r["metadata"] {
    case .object?, .array?: metadata = r["metadata"]
    default: metadata = nil
    }
    return ConversationTask(
      id: id, subject: subject, status: status,
      description: r["description"]?.stringValue, activeForm: r["activeForm"]?.stringValue,
      owner: r["owner"]?.stringValue, blocks: strings(r["blocks"]),
      blockedBy: strings(r["blockedBy"]), metadata: metadata)
  }

  /// A `TaskCreate` as a task: the echoed JSON result, else the input plus the
  /// id from "Task #<id> created", else a `pending:` placeholder id.
  static func taskFromCreateCall(_ tc: ConversationToolCall) -> Patch? {
    guard tc.name == "TaskCreate" else { return nil }
    if let fromResult = coerceTask(parsedResult(tc)) {
      return Patch(task: fromResult, keys: .all)
    }
    guard let subject = nonEmptyString(tc.input?["subject"]) else { return nil }
    let text = resultText(tc.result) ?? ""
    var id = "pending:\(tc.id ?? "undefined")"
    if let match = text.firstMatch(of: /Task #(\S+) created/) {
      id = String(match.1)
    }
    return Patch(
      task: ConversationTask(
        id: id, subject: subject, status: .pending,
        description: tc.input?["description"]?.stringValue,
        activeForm: tc.input?["activeForm"]?.stringValue),
      keys: .base)
  }

  static func findTaskCreate(in messages: [ConversationMessage], id: String) -> Patch? {
    func walk(_ calls: [ConversationToolCall]) -> Patch? {
      for tc in calls {
        if tc.name == "TaskCreate", let t = taskFromCreateCall(tc), t.task.id == id {
          return t
        }
        for child in tc.children ?? [] {
          if case .toolUse(let call) = child, let found = walk([call]) { return found }
        }
      }
      return nil
    }
    for m in messages {
      if let found = walk(m.toolCalls) { return found }
    }
    return nil
  }

  static func apply(_ tc: ConversationToolCall, to state: inout State, messages: [ConversationMessage]?) {
    switch tc.name {
    case "TaskList":
      // Authoritative snapshot; tasks it omits are kept.
      for raw in parsedResult(tc)?.arrayValue ?? [] {
        if let t = coerceTask(raw) { state.upsert(Patch(task: t, keys: .all)) }
      }
    case "TaskGet":
      if let t = coerceTask(parsedResult(tc)) { state.upsert(Patch(task: t, keys: .all)) }
    case "TaskCreate":
      if let created = taskFromCreateCall(tc) { state.upsert(created) }
    case "TaskUpdate":
      applyUpdate(tc, to: &state, messages: messages)
    default:
      break
    }
  }

  private static func applyUpdate(
    _ tc: ConversationToolCall, to state: inout State, messages: [ConversationMessage]?
  ) {
    let input = tc.input ?? [:]
    guard let taskId = nonEmptyString(input["taskId"]) else { return }
    let status = coerceStatus(input["status"])
    if case .deleted? = status {
      state.delete(taskId)
      return
    }
    if state.tasks[taskId] == nil {
      // Likely cleared by the user: recover just this entry from its TaskCreate.
      guard let messages, let recovered = findTaskCreate(in: messages, id: taskId) else { return }
      state.upsert(recovered)
    }
    guard let existing = state.tasks[taskId] else { return }
    var newStatus = existing.status
    if case .known(let s)? = status { newStatus = s }
    let merged = ConversationTask(
      id: taskId,
      subject: input["subject"]?.stringValue ?? existing.subject,
      status: newStatus,
      description: input["description"]?.stringValue ?? existing.description,
      activeForm: input["activeForm"]?.stringValue ?? existing.activeForm,
      owner: input["owner"]?.stringValue ?? existing.owner,
      blocks: strings(input["addBlocks"]).map { (existing.blocks ?? []) + $0 } ?? existing.blocks,
      blockedBy: strings(input["addBlockedBy"]).map { (existing.blockedBy ?? []) + $0 }
        ?? existing.blockedBy)
    state.upsert(Patch(task: merged, keys: [.base, .owner, .links]))
  }

  /// Full re-derivation, used when loading saved messages.
  static func extract(from messages: [ConversationMessage]) -> State? {
    var state = State(tasks: [:], order: [])
    var sawAny = false
    func walk(_ calls: [ConversationToolCall]) {
      for tc in calls {
        if let name = tc.name, taskToolNames.contains(name) {
          sawAny = true
          apply(tc, to: &state, messages: nil)
        }
        for child in tc.children ?? [] {
          if case .toolUse(let call) = child { walk([call]) }
        }
      }
    }
    for m in messages { walk(m.toolCalls) }
    return sawAny ? state : nil
  }

  /// Incremental fold on the live path — never a re-derivation, which would
  /// resurrect tasks the user cleared.
  static func applyLive(
    tasks: [String: ConversationTask]?, order: [String]?, calls: [ConversationToolCall],
    messages: [ConversationMessage]
  ) -> State? {
    guard !calls.isEmpty else { return nil }
    var state = State(tasks: tasks ?? [:], order: order ?? [])
    for tc in calls { apply(tc, to: &state, messages: messages) }
    return state
  }
}
