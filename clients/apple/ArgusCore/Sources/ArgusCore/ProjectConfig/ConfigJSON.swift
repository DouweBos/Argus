import ArgusKit
import Foundation

/// Pretty-prints a `.argus.json` the way the desktop writes it (two-space
/// indent, integers without a fraction), with keys in the documented order so
/// a save doesn't reshuffle the file a team reviews. Keys it doesn't know go
/// last, alphabetically.
public enum ConfigJSON {
  public static func string(_ value: JSONValue) -> String {
    var out = ""
    write(value, path: [], indent: "", into: &out)
    return out
  }

  /// `.number(3)` as `3`, not `3.0`.
  static func number(_ value: Double) -> String {
    if value.isFinite, value.rounded() == value, abs(value) < 1e15 {
      return String(Int64(value))
    }
    return String(value)
  }

  private static func write(_ value: JSONValue, path: [String], indent: String, into out: inout String) {
    switch value {
    case .null: out += "null"
    case .bool(let v): out += v ? "true" : "false"
    case .number(let v): out += number(v)
    case .string(let v): out += quoted(v)
    case .array(let items):
      guard !items.isEmpty else { return out += "[]" }
      let inner = indent + "  "
      out += "[\n"
      for (index, item) in items.enumerated() {
        out += inner
        write(item, path: path + ["[]"], indent: inner, into: &out)
        out += index == items.count - 1 ? "\n" : ",\n"
      }
      out += indent + "]"
    case .object(let fields):
      guard !fields.isEmpty else { return out += "{}" }
      let inner = indent + "  "
      let keys = ordered(Array(fields.keys), at: path)
      out += "{\n"
      for (index, key) in keys.enumerated() {
        out += inner + quoted(key) + ": "
        write(fields[key]!, path: path + [key], indent: inner, into: &out)
        out += index == keys.count - 1 ? "\n" : ",\n"
      }
      out += indent + "}"
    }
  }

  static func ordered(_ keys: [String], at path: [String]) -> [String] {
    // MCP server configs and other free-form maps keep their own order.
    let preferred = keyOrder[path.joined(separator: ".")] ?? []
    let known = preferred.filter(keys.contains)
    let rest = keys.filter { !preferred.contains($0) }.sorted()
    return known + rest
  }

  private static let keyOrder: [String: [String]] = [
    "": [
      "setup", "terminals", "run", "workspace_env",
      "related_projects", "browser_url", "browser_presets", "simulator_deeplinks",
      "auto_continue_on_limit", "protected_branches",
      "default_base_branch", "single_runtime",
      "auto_fetch_minutes", "release_note_patterns", "llm", "tools", "automations",
    ],
    "setup": ["copy", "symlink", "commands"],
    "setup.copy.[]": ["path", "exclude"],
    "setup.symlink.[]": ["path", "exclude"],
    "terminals.[]": ["name", "dir"],
    "run.[]": ["title", "command", "cwd", "restartOnRerun", "requires"],
    "workspace_env.[]": ["name", "base_value", "range", "strategy"],
    "related_projects.[]": ["path", "description"],
    "browser_presets.[]": ["id", "label", "width", "height", "user_agent"],
    "release_note_patterns.[]": ["glob", "format", "labels"],
    "release_note_patterns.[].labels.[]": ["name", "selector", "tone"],
    "llm": ["runner", "model"],
    "tools": ["disabled"],
    "automations": ["autonomy_ceiling", "disabled", "path_denylist"],
  ].merging(deeplinkOrders) { a, _ in a }

  /// Deep links nest; a few levels covers any sane tree.
  private static var deeplinkOrders: [String: [String]] {
    var orders: [String: [String]] = [:]
    var path = "simulator_deeplinks.[]"
    for _ in 0..<8 {
      orders[path] = ["label", "url", "children"]
      path += ".children.[]"
    }
    return orders
  }

  static func quoted(_ text: String) -> String {
    var out = "\""
    for scalar in text.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    return out + "\""
  }

  /// Parses one free-form JSON value, e.g. an MCP server's config.
  public static func parse(_ text: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
  }
}
