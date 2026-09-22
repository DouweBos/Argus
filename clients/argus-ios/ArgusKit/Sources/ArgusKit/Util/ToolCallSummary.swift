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

  /// The expanded input view: a raw command for Bash, pretty JSON otherwise.
  public static func formatInput(name: String, input: [String: JSONValue]) -> String {
    if name == "Bash", let command = input["command"]?.stringValue {
      return command
    }
    return JSONValue.object(input).prettyPrinted
  }
}
