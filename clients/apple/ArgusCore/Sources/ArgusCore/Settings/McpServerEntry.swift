import ArgusKit
import Foundation

/// One editable row of an `mcp_servers` map: a name and its JSON config as
/// typed, so a half-written config stays on screen until it parses.
public struct McpServerEntry: Identifiable, Hashable, Sendable {
  public let id: UUID
  public var name: String
  public var json: String

  public static let sampleJSON = """
    {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
    """

  public init(id: UUID = UUID(), name: String = "", json: String = McpServerEntry.sampleJSON) {
    self.id = id
    self.name = name
    self.json = json
  }

  /// Why this row can't be saved, or nil when it can.
  public var error: String? {
    if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Name is required." }
    do {
      let parsed = try JSONSerialization.jsonObject(
        with: Data(json.utf8), options: [.fragmentsAllowed])
      guard parsed is [String: Any] else { return "Config must be a JSON object." }
    } catch {
      return "Invalid JSON: \((error as NSError).userInfo[NSDebugDescriptionErrorKey] as? String ?? error.localizedDescription)"
    }
    return nil
  }

  /// The parsed config, when the row is valid.
  public var config: [String: JSONValue]? {
    guard error == nil else { return nil }
    return try? JSONDecoder().decode([String: JSONValue].self, from: Data(json.utf8))
  }

  /// The server's URL, for an HTTP server that may need signing in to.
  public var url: String? {
    if case .string(let url)? = config?["url"] { return url }
    return nil
  }

  public static func entries(from map: [String: [String: JSONValue]]?) -> [McpServerEntry] {
    (map ?? [:]).sorted { $0.key < $1.key }.map { name, config in
      McpServerEntry(name: name, json: pretty(config))
    }
  }

  /// The `{ name: config }` map written to disk; invalid rows are left out.
  public static func map(from entries: [McpServerEntry]) -> [String: [String: JSONValue]] {
    var out: [String: [String: JSONValue]] = [:]
    for entry in entries {
      if let config = entry.config {
        out[entry.name.trimmingCharacters(in: .whitespacesAndNewlines)] = config
      }
    }
    return out
  }

  public static func allValid(_ entries: [McpServerEntry]) -> Bool {
    entries.allSatisfy { $0.error == nil }
  }

  /// macOS text views type curly quotes, which no JSON parser accepts.
  public static func straighteningQuotes(_ text: String) -> String {
    text.replacingOccurrences(of: "[\u{201C}\u{201D}]", with: "\"", options: .regularExpression)
      .replacingOccurrences(of: "[\u{2018}\u{2019}]", with: "'", options: .regularExpression)
  }

  public static func pretty(_ config: [String: JSONValue]) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? encoder.encode(config) else { return "{}" }
    return String(decoding: data, as: UTF8.self)
  }
}
