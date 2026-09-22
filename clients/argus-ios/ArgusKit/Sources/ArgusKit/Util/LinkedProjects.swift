import Foundation

/// The preamble that carries linked projects with a message.
///
/// Byte-identical to the desktop's `linkedProjectsPreamble` and the Expo
/// client's copy, so all three render the same chips and round-trip each
/// other's messages. The head text is also a live instruction to the agent —
/// editing it changes behaviour, not just formatting.
public enum LinkedProjects {
  static let head = """
    [Linked project directories — the user has explicitly attached the \
    following project roots to this chat. You are allowed to read from and \
    make changes in these directories in addition to your own worktree, but \
    you MUST NOT switch branches, check out other refs, or otherwise alter \
    the git state of these roots — they are shared with the user's other \
    work. If you need to silo changes on a separate branch in one of these \
    projects, use the Argus MCP `create_session` (or `spawn_agent`) tool to \
    open a new session in that project instead of switching branches here:
    """

  public static func buildPreamble(paths: [String], message: String) -> String {
    guard !paths.isEmpty else { return message }
    let lines = paths.map { "- \($0)" }.joined(separator: "\n")
    return "\(head)\n\(lines)]\n\n\(message)"
  }

  public struct Parsed: Sendable, Equatable {
    public var paths: [String]
    public var rest: String
  }

  /// Strip the preamble so the transcript can render chips instead of the raw
  /// bracket text. Returns nil when the text does not start with it.
  public static func parsePreamble(_ text: String) -> Parsed? {
    guard text.hasPrefix(head) else { return nil }
    let afterHead = text.dropFirst(head.count)
    guard let close = afterHead.firstIndex(of: "]") else { return nil }

    let paths = afterHead[..<close]
      .split(separator: "\n", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .filter { $0.hasPrefix("- ") }
      .map { $0.dropFirst(2).trimmingCharacters(in: .whitespaces) }
    guard !paths.isEmpty else { return nil }

    var rest = String(afterHead[afterHead.index(after: close)...])
    while rest.hasPrefix("\n") { rest.removeFirst() }
    return Parsed(paths: paths, rest: rest)
  }
}
