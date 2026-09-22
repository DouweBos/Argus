import Foundation

/// Unified-diff parsing for the Changes screen, ported from `diff.ts`.

public enum DiffLineKind: String, Sendable {
  case context, add, remove, noNewline
}

public struct DiffLine: Hashable, Sendable, Identifiable {
  public var kind: DiffLineKind
  public var text: String
  public var oldNumber: Int?
  public var newNumber: Int?
  public var id: Int

  public init(kind: DiffLineKind, text: String, oldNumber: Int?, newNumber: Int?, id: Int) {
    self.kind = kind
    self.text = text
    self.oldNumber = oldNumber
    self.newNumber = newNumber
    self.id = id
  }
}

public struct DiffHunk: Hashable, Sendable, Identifiable {
  public var header: String
  public var lines: [DiffLine]
  public var id: String { header }
}

public enum DiffFileStatus: String, Sendable {
  case added = "A"
  case deleted = "D"
  case modified = "M"
  case renamed = "R"

  public var label: String {
    switch self {
    case .added: "added"
    case .deleted: "deleted"
    case .modified: "modified"
    case .renamed: "renamed"
    }
  }
}

public struct DiffFile: Hashable, Sendable, Identifiable {
  public var oldPath: String
  public var newPath: String
  public var status: DiffFileStatus
  public var hunks: [DiffHunk]
  public var isBinary: Bool

  public var id: String { newPath.isEmpty ? oldPath : newPath }
  public var displayPath: String { newPath.isEmpty ? oldPath : newPath }

  public var additions: Int {
    hunks.reduce(0) { $0 + $1.lines.count { $0.kind == .add } }
  }
  public var deletions: Int {
    hunks.reduce(0) { $0 + $1.lines.count { $0.kind == .remove } }
  }
}

public enum DiffParser {
  /// Unquote a path git chose to escape (spaces, non-ASCII).
  static func unquote(_ raw: String) -> String {
    var path = raw.trimmingCharacters(in: .whitespaces)
    guard path.hasPrefix("\"") && path.hasSuffix("\"") && path.count >= 2 else { return path }
    path = String(path.dropFirst().dropLast())
    return path
      .replacingOccurrences(of: "\\\"", with: "\"")
      .replacingOccurrences(of: "\\\\", with: "\\")
  }

  /// `diff --git a/x b/y` — the fallback when there are no `---`/`+++` lines,
  /// which is what a pure rename or a binary change looks like.
  static func pathsFromGitLine(_ line: String) -> (old: String, new: String) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("\"") {
      // Both paths quoted: "a/one two" "b/three four"
      let parts = trimmed.components(separatedBy: "\" \"")
      if parts.count == 2 {
        return (unquote(parts[0] + "\"").replacingOccurrences(of: "a/", with: "", options: .anchored),
                unquote("\"" + parts[1]).replacingOccurrences(of: "b/", with: "", options: .anchored))
      }
      return ("", "")
    }
    guard trimmed.hasPrefix("a/"), let range = trimmed.range(of: " b/") else { return ("", "") }
    return (
      String(trimmed[trimmed.index(trimmed.startIndex, offsetBy: 2)..<range.lowerBound]),
      String(trimmed[range.upperBound...])
    )
  }

  static func stripPrefix(_ line: String, _ marker: String, _ pathPrefix: String) -> String {
    var value = String(line.dropFirst(marker.count))
    if value.hasPrefix(pathPrefix) { value.removeFirst(pathPrefix.count) }
    return value == "/dev/null" ? "" : unquote(value)
  }

  public static func parse(_ raw: String) -> [DiffFile] {
    // Split on the file boundary. The reference splits with `/^diff --git /m`,
    // which leaves the newline *before* each boundary attached to the previous
    // chunk — so every file but the last ends with a blank line, and that
    // blank is parsed as a trailing context row. Reproduced rather than
    // tidied up, so both clients render a file identically.
    let chunks = raw.components(separatedBy: "\ndiff --git ")
    var normalized: [String] = []
    for (index, chunk) in chunks.enumerated() {
      var body = chunk
      if index == 0 {
        guard body.hasPrefix("diff --git ") else { continue }
        body.removeFirst("diff --git ".count)
      }
      if index < chunks.count - 1 { body += "\n" }
      normalized.append(body)
    }

    return normalized.compactMap { chunk in
      let lines = chunk.components(separatedBy: "\n")
      var oldPath = ""
      var newPath = ""
      var bodyStart = 0
      var isBinary = false

      for (index, line) in lines.enumerated() {
        if line.hasPrefix("--- ") {
          oldPath = stripPrefix(line, "--- ", "a/")
        } else if line.hasPrefix("+++ ") {
          newPath = stripPrefix(line, "+++ ", "b/")
          bodyStart = index + 1
          break
        }
      }

      if oldPath.isEmpty && newPath.isEmpty {
        let fromGit = pathsFromGitLine(lines.first ?? "")
        oldPath = fromGit.old
        newPath = fromGit.new
      }

      var renameFrom = ""
      var renameTo = ""
      for line in lines {
        if line.hasPrefix("rename from ") {
          renameFrom = unquote(String(line.dropFirst("rename from ".count)))
        } else if line.hasPrefix("rename to ") {
          renameTo = unquote(String(line.dropFirst("rename to ".count)))
        } else if line.hasPrefix("Binary files ") || line.hasPrefix("GIT binary patch") {
          isBinary = true
        }
      }
      if oldPath.isEmpty, !renameFrom.isEmpty { oldPath = renameFrom }
      if newPath.isEmpty, !renameTo.isEmpty { newPath = renameTo }

      let status: DiffFileStatus
      if oldPath.isEmpty {
        status = .added
      } else if newPath.isEmpty {
        status = .deleted
      } else if oldPath != newPath {
        status = .renamed
      } else {
        status = .modified
      }

      var hunks: [DiffHunk] = []
      var current: DiffHunk?
      var nextOld = 0
      var nextNew = 0
      var lineId = 0

      for line in lines.dropFirst(bodyStart) {
        if let starts = hunkStarts(line) {
          if let open = current { hunks.append(open) }
          current = DiffHunk(header: line, lines: [])
          nextOld = starts.old
          nextNew = starts.new
          continue
        }
        guard current != nil else { continue }
        lineId += 1

        if line.hasPrefix("+") {
          current?.lines.append(
            DiffLine(kind: .add, text: String(line.dropFirst()),
                     oldNumber: nil, newNumber: nextNew, id: lineId))
          nextNew += 1
        } else if line.hasPrefix("-") {
          current?.lines.append(
            DiffLine(kind: .remove, text: String(line.dropFirst()),
                     oldNumber: nextOld, newNumber: nil, id: lineId))
          nextOld += 1
        } else if line.hasPrefix(" ") || line.isEmpty {
          current?.lines.append(
            DiffLine(kind: .context, text: line.isEmpty ? "" : String(line.dropFirst()),
                     oldNumber: nextOld, newNumber: nextNew, id: lineId))
          nextOld += 1
          nextNew += 1
        } else if line.hasPrefix("\\") {
          // "\ No newline at end of file" attaches to the preceding line
          // rather than consuming a numbered slot of its own.
          current?.lines.append(
            DiffLine(kind: .noNewline, text: String(line.dropFirst(2)),
                     oldNumber: nil, newNumber: nil, id: lineId))
        }
      }
      if let open = current { hunks.append(open) }

      return DiffFile(
        oldPath: oldPath, newPath: newPath, status: status,
        hunks: hunks, isBinary: isBinary)
    }
  }

  /// Parse `@@ -a,b +c,d @@` into the two starting line numbers.
  static func hunkStarts(_ header: String) -> (old: Int, new: Int)? {
    guard header.hasPrefix("@@ -") else { return nil }
    guard let match = header.range(
      of: #"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@"#, options: .regularExpression)
    else { return nil }
    let spec = header[match].dropFirst(4)
    let sides = spec.components(separatedBy: " +")
    guard sides.count >= 2,
      let old = Int(sides[0].components(separatedBy: ",")[0]),
      let new = Int(sides[1].components(separatedBy: " ")[0].components(separatedBy: ",")[0])
    else { return nil }
    return (old, new)
  }
}
