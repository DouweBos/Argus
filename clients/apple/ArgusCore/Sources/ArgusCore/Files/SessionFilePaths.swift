import Foundation

/// Turns a path as an agent wrote it into one `files.read` accepts: relative to the
/// session's worktree. A client doesn't know where the worktree lives, so an absolute
/// path is matched against the session's file list by suffix.
public enum SessionFilePaths {
  /// Absolute and `~/` paths can only be placed with the session's file list.
  public static func needsFileList(_ raw: String) -> Bool {
    let path = raw.trimmingCharacters(in: .whitespaces)
    return path.hasPrefix("/") || path.hasPrefix("~")
  }

  /// The worktree-relative path, or nil when `raw` can't name a file in this session.
  public static func relative(_ raw: String, files: [String]) -> String? {
    let path = raw.trimmingCharacters(in: .whitespaces)
    guard !path.isEmpty else { return nil }
    if needsFileList(path) {
      let candidates = files.filter { path == $0 || path.hasSuffix("/" + $0) }
      return candidates.max { $0.utf16.count < $1.utf16.count }
    }
    return normalized(path)
  }

  /// `./a/../b.ts` → `b.ts`; nil when it climbs out of the worktree.
  static func normalized(_ path: String) -> String? {
    var parts: [Substring] = []
    for part in path.split(separator: "/", omittingEmptySubsequences: true) {
      switch part {
      case ".": continue
      case "..":
        guard !parts.isEmpty else { return nil }
        parts.removeLast()
      default: parts.append(part)
      }
    }
    return parts.isEmpty ? nil : parts.joined(separator: "/")
  }

  /// The last path component, for titles.
  public static func fileName(_ path: String) -> String {
    path.split(separator: "/").last.map(String.init) ?? path
  }

  /// Everything before the file name, for subtitles; empty at the worktree root.
  public static func directory(_ path: String) -> String {
    guard let slash = path.lastIndex(of: "/") else { return "" }
    return String(path[..<slash])
  }
}
