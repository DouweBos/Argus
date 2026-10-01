import Foundation

/// The rule an "Always allow" answer adds for the rest of the session, as
/// `app/components/agent/alwaysAllowRule.ts` derives it: a command's binary,
/// a file's extension, a URL's domain, else the whole tool.
public enum AlwaysAllowRule {
  public static func rule(name: String, input: [String: JSONValue]) -> String {
    switch name {
    case "Bash":
      let command = (input["command"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      let binary = command.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
      return binary.isEmpty ? name : "\(name)(\(binary) *)"
    case "Edit", "MultiEdit", "Write", "Read":
      let path = input["file_path"]?.stringValue ?? input["path"]?.stringValue ?? ""
      // JS `split(".").pop()`: everything after the last dot, or the whole path.
      let ext = path.split(separator: ".", omittingEmptySubsequences: false).last.map(String.init)
      if let ext, ext != path, !ext.contains("/") {
        return "\(name)(**/*.\(ext))"
      }
      return name
    case "WebFetch":
      guard let url = input["url"]?.stringValue, let host = URL(string: url)?.host(), !host.isEmpty
      else { return name }
      return "\(name)(domain:\(host))"
    default:
      return name
    }
  }
}
