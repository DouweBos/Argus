import Foundation

/// Folding runs of tool-only messages into one collapsed row, ported from
/// `toolGroups.ts`.
public enum ToolGroups {
  /// Shorter runs are left expanded — collapsing two rows saves nothing and
  /// costs the reader a tap.
  public static let minRun = 3

  /// Tool calls that carry the substance of a turn, so a message containing
  /// one is never folded away.
  private static let substantive: Set<String> = ["Agent", "Edit", "MultiEdit", "Write"]

  public static func isToolCallOnly(_ message: RemoteMessage) -> Bool {
    guard message.role == .assistant, !message.toolCalls.isEmpty else { return false }
    guard message.textBlocks.allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
    else { return false }
    return !message.toolCalls.contains { substantive.contains($0.name) || awaitsDecision($0) }
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

  public static func group(_ messages: [RemoteMessage]) -> [Segment] {
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
      if isToolCallOnly(message) {
        run.append(message)
      } else {
        flush()
        segments.append(.single(message))
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
