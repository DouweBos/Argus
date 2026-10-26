import Foundation

/// Folding runs of tool-only messages into one collapsed row, ported from
/// `toolGroups.ts`.
public enum ToolGroups {
  /// A lone call is left expanded — folding one row saves nothing.
  public static let minRun = 2

  /// Tool calls that carry the substance of a turn, so a message containing
  /// one is never folded away.
  private static let substantive: Set<String> = ["Agent", "Edit", "MultiEdit", "Write"]

  /// `hoistImageReads`: image reads are shown open (a user setting), and an
  /// open card inside a folded group is hidden all the same.
  public static func isToolCallOnly(_ message: RemoteMessage, hoistImageReads: Bool = false)
    -> Bool
  {
    guard message.role == .assistant, !message.toolCalls.isEmpty else { return false }
    guard message.textBlocks.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
    else { return false }
    return !message.toolCalls.contains {
      substantive.contains($0.name) || isPushNotification($0) || awaitsDecision($0)
        || (hoistImageReads && isImageRead($0))
    }
  }

  /// The agent deliberately reached for your phone; never fold that away.
  public static func isPushNotification(_ call: RemoteToolCall) -> Bool {
    call.name == "mcp__argus__push_notification"
  }

  public static func isImageRead(_ call: RemoteToolCall) -> Bool {
    call.name == "Read" && call.resultBlocks.contains {
      if case .image = $0 { return true }
      return false
    }
  }

  /// A call waiting on approval, here or in a sub-agent under it, must never be
  /// folded out of sight.
  public static func awaitsDecision(_ call: RemoteToolCall) -> Bool {
    if call.status == .pending || call.pendingPermission == true { return true }
    return (call.children ?? []).contains { child in
      guard case .toolUse(let nested) = child else { return false }
      return awaitsDecision(nested)
    }
  }

  /// Thinking- or usage-only messages arrive with nothing to draw; rendering
  /// them leaves a bare timestamp and splits runs that should fold together.
  public static func hasVisibleContent(_ message: RemoteMessage) -> Bool {
    !message.toolCalls.isEmpty
      || !(message.images ?? []).isEmpty
      || message.isError == true
      || message.textBlocks.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  }

  public enum Segment: Identifiable, Sendable {
    case collapsed([RemoteMessage])
    case single(RemoteMessage)

    public var id: String {
      switch self {
      case .collapsed(let messages): "group-\(messages.first?.id ?? "")"
      case .single(let message): message.id
      }
    }
  }

  public static func group(_ messages: [RemoteMessage], hoistImageReads: Bool = false)
    -> [Segment]
  {
    var segments: [Segment] = []
    var run: [RemoteMessage] = []

    func flush() {
      guard !run.isEmpty else { return }
      if run.count >= minRun {
        segments.append(.collapsed(run))
      } else {
        segments.append(contentsOf: run.map(Segment.single))
      }
      run = []
    }

    for message in messages where hasVisibleContent(message) {
      if isToolCallOnly(message, hoistImageReads: hoistImageReads) {
        run.append(message)
      } else {
        flush()
        segments.append(.single(message))
      }
    }
    flush()
    return segments
  }

  // MARK: Turns

  /// How a chat folds: runs of tool-only messages, or each turn's work as one log.
  public enum Folding: Sendable {
    case runs
    case turns
  }

  /// What a turn's work log never folds away: errors, decisions waiting on
  /// you, a push to your phone, and messages from another agent or tool.
  public static func staysOpen(_ message: RemoteMessage, hoistImageReads: Bool = false) -> Bool {
    message.isError == true || message.source != nil || message.author != nil
      || message.toolCalls.contains {
        isPushNotification($0) || awaitsDecision($0) || (hoistImageReads && isImageRead($0))
      }
  }

  /// Text and nothing else: what the agent says rather than does.
  public static func isReply(_ message: RemoteMessage) -> Bool {
    message.role == .assistant && message.toolCalls.isEmpty && (message.images ?? []).isEmpty
      && message.textBlocks.contains { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
  }

  /// Each assistant turn's tool calls and the narration between them as one
  /// collapsed segment; the user's messages, the turn's closing reply and
  /// whatever `staysOpen` stand on their own. Work with no tool call isn't folded.
  public static func groupTurns(_ messages: [RemoteMessage], hoistImageReads: Bool = false) -> [Segment] {
    foldTurns(messages.enumerated().map { ($0.offset, $0.element) }, hoistImageReads: hoistImageReads).map(\.segment)
  }

  /// `groupTurns` over indexed messages, with each segment's first index.
  public static func foldTurns(
    _ messages: [(Int, RemoteMessage)], hoistImageReads: Bool = false
  ) -> [(start: Int, segment: Segment)] {
    var segments: [(start: Int, segment: Segment)] = []
    var work: [(Int, RemoteMessage)] = []

    func flush() {
      guard !work.isEmpty else { return }
      var tail = work.count
      while tail > 0, isReply(work[tail - 1].1) { tail -= 1 }
      let folded = work[..<tail]
      if folded.contains(where: { !$0.1.toolCalls.isEmpty }) {
        segments.append((folded[folded.startIndex].0, .collapsed(folded.map(\.1))))
      } else {
        segments.append(contentsOf: folded.map { ($0.0, .single($0.1)) })
      }
      segments.append(contentsOf: work[tail...].map { ($0.0, .single($0.1)) })
      work = []
    }

    for (index, message) in messages where hasVisibleContent(message) {
      if message.role != .assistant || staysOpen(message, hoistImageReads: hoistImageReads) {
        flush()
        segments.append((index, .single(message)))
      } else {
        work.append((index, message))
      }
    }
    flush()
    return segments
  }

  public enum ToolCategory: String, CaseIterable, Sendable {
    case read, search, bash, edit, web, agent, other
  }

  public static func category(for name: String) -> ToolCategory {
    switch name {
    case "Read", "LS", "NotebookRead": .read
    case "Grep", "Glob": .search
    case "Bash", "BashOutput", "KillShell": .bash
    case "Edit", "MultiEdit", "Write", "NotebookEdit": .edit
    case "WebFetch", "WebSearch": .web
    case "Agent", "Task": .agent
    default: .other
    }
  }

  public static func categorize(_ messages: [RemoteMessage]) -> [(ToolCategory, Int)] {
    var counts: [ToolCategory: Int] = [:]
    var order: [ToolCategory] = []
    for message in messages {
      for call in message.toolCalls {
        let category = category(for: call.name)
        if counts[category] == nil { order.append(category) }
        counts[category, default: 0] += 1
      }
    }
    return order.compactMap { category in
      counts[category].map { (category, $0) }
    }
  }

  public static func countToolCalls(_ messages: [RemoteMessage]) -> Int {
    messages.reduce(0) { $0 + $1.toolCalls.count }
  }
}
