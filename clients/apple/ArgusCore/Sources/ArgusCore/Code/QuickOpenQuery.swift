import Foundation

/// What the quick open field asks for: VS Code's prefixes (`@` symbols in the file, `#` symbols
/// in the workspace, `:` a line) on top of the palette's own mode.
public enum QuickOpenQuery: Equatable, Sendable {
  case files(String)
  /// Files and workspace symbols together (Open Quickly).
  case mixed(String)
  case workspaceSymbols(String)
  /// `@:` lists them grouped by kind.
  case fileSymbols(String, grouped: Bool)
  /// Nil while no number is typed yet; both 1-based.
  case line(Int?, column: Int?)

  /// What text without a prefix means.
  public enum Base: Sendable {
    case files, mixed
  }

  public static func parse(_ text: String, base: Base) -> QuickOpenQuery {
    guard let first = text.first else { return base == .files ? .files("") : .mixed("") }
    let rest = String(text.dropFirst())
    switch first {
    case "@":
      return rest.hasPrefix(":")
        ? .fileSymbols(trimmed(rest.dropFirst()), grouped: true) : .fileSymbols(trimmed(rest), grouped: false)
    case "#":
      return .workspaceSymbols(trimmed(rest))
    case ":":
      let parts = rest.split(whereSeparator: { $0 == ":" || $0 == "," }).map { Int($0.trimmingCharacters(in: .whitespaces)) }
      let line = parts.first.flatMap { $0 }.flatMap { $0 > 0 ? $0 : nil }
      let column = parts.count > 1 ? parts[1].flatMap { $0 > 0 ? $0 : nil } : nil
      return .line(line, column: line == nil ? nil : column)
    default:
      return base == .files ? .files(text) : .mixed(text)
    }
  }

  private static func trimmed(_ text: Substring) -> String {
    text.trimmingCharacters(in: .whitespaces)
  }

  private static func trimmed(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespaces)
  }
}
