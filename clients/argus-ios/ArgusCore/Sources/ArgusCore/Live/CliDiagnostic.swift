import Foundation

/// A structured diagnostic the Claude Code CLI writes to stderr as
/// `[claude-code:<code>] {json}`. A notice the run survived, not a failure, so
/// it reads as a warning with spelled-out fields. Port of `cliDiagnostics.ts`.
public struct CliDiagnostic: Equatable, Sendable {
  public var code: String
  public var title: String
  /// One `Label: value` line per payload field.
  public var details: [String]

  /// Nil when the line isn't a structured diagnostic.
  public static func parse(_ line: String) -> CliDiagnostic? {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard
      let match = trimmed.firstMatch(
        of: #/^\[claude-code:([a-z0-9_]+)\]\s*(.*)$/#.ignoresCase().dotMatchesNewlines())
    else { return nil }
    let code = String(match.1)
    let rest = String(match.2).trimmingCharacters(in: .whitespacesAndNewlines)
    return CliDiagnostic(code: code, title: humanize(code), details: describe(rest))
  }

  /// `unrecognized_model` → `Unrecognized model`.
  static func humanize(_ token: String) -> String {
    let words = token.replacingOccurrences(of: "_", with: " ")
      .trimmingCharacters(in: .whitespaces)
    return words.prefix(1).uppercased() + words.dropFirst()
  }

  /// Anything that isn't a flat JSON object stays the single line it was.
  static func describe(_ rest: String) -> [String] {
    guard !rest.isEmpty else { return [] }
    guard let parsed = JS.parse(rest), case .object(let fields) = parsed else { return [rest] }
    // JSON.parse keeps insertion order; Swift dictionaries don't, so follow the source text.
    return fields.keys.sorted { rest.range(of: "\"\($0)\"")?.lowerBound ?? rest.endIndex
      < rest.range(of: "\"\($1)\"")?.lowerBound ?? rest.endIndex }
      .map { key in
        let value = fields[key]!
        switch value {
        case .object, .array: return "\(humanize(key)): \(JS.stringify(value))"
        default: return "\(humanize(key)): \(JS.interpolate(value))"
        }
      }
  }
}
