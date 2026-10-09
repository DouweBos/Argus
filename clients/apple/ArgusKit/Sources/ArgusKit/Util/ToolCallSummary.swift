import Foundation

/// One-line summaries for a collapsed tool call, ported from `toolCall.ts`.
public enum ToolCallSummary {
  /// Tools whose summary is a path. Those get head-truncation in the UI —
  /// when a path is too long it is the filename you want to keep.
  public static let pathTools: Set<String> = ["Read", "Edit", "MultiEdit", "Write", "LS"]

  public static func isPathTool(_ name: String) -> Bool { pathTools.contains(name) }

  public static func summary(name: String, input: [String: JSONValue]) -> String {
    func clip(_ s: String, _ n: Int) -> String {
      s.count > n ? String(s.prefix(n)) + "…" : s
    }
    switch name {
    case "Read", "Edit", "MultiEdit", "Write":
      return input["file_path"]?.stringValue ?? input["path"]?.stringValue ?? ""
    case "LS":
      return input["path"]?.stringValue ?? "."
    case "Bash":
      return clip(input["command"]?.stringValue ?? "", 60)
    case "Glob", "Grep":
      return input["pattern"]?.stringValue ?? ""
    case "Task", "WebSearch":
      return clip(
        input["description"]?.stringValue ?? input["query"]?.stringValue ?? "", 60)
    case "WebFetch":
      return clip(input["url"]?.stringValue ?? "", 60)
    case "Agent":
      let type = input["subagent_type"]?.stringValue ?? "agent"
      let description = input["description"]?.stringValue ?? ""
      return description.isEmpty ? type : "\(type): \(clip(description, 80))"
    default:
      return ""
    }
  }

  /// Agent and Task calls run a subagent whose own calls nest under them.
  public static func isSubagent(_ name: String) -> Bool { name == "Agent" || name == "Task" }

  /// What a call is called in a row: an Agent call goes by its subagent type.
  public static func label(name: String, input: [String: JSONValue]) -> String {
    guard name == "Agent" else { return name }
    let type = input["subagent_type"]?.stringValue ?? ""
    return type.isEmpty ? "Agent" : type
  }

  /// A subagent's newest calls for its collapsed preview, and how many came before them.
  public static func subagentPreview(
    _ call: RemoteToolCall, limit: Int = 5
  ) -> (calls: [RemoteToolCall], earlier: Int) {
    let calls = (call.children ?? []).compactMap { child -> RemoteToolCall? in
      if case .toolUse(let nested) = child { return nested }
      return nil
    }
    let shown = Array(calls.suffix(limit))
    return (shown, calls.count - shown.count)
  }
}
