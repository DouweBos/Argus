import Foundation

/// Inline Edit/Write previews inside a tool call, ported from `diffLines.ts`.
///
/// Not a real diff algorithm: it matches the shared prefix and suffix and
/// treats everything between as replaced. That is what an Edit tool call
/// actually did, and it renders instantly on a phone.
public enum InlineDiff {
  public struct Stats: Sendable, Equatable {
    public var additions: Int
    public var deletions: Int
  }

  static func matchEdges(_ old: [String], _ new: [String]) -> (prefix: Int, suffix: Int) {
    let limit = min(old.count, new.count)
    var prefix = 0
    while prefix < limit && old[prefix] == new[prefix] { prefix += 1 }
    var suffix = 0
    while suffix < limit - prefix
      && old[old.count - 1 - suffix] == new[new.count - 1 - suffix]
    {
      suffix += 1
    }
    return (prefix, suffix)
  }

  public static func compute(old: String, new: String) -> [DiffLine] {
    let oldLines = old.isEmpty ? [] : old.components(separatedBy: "\n")
    let newLines = new.isEmpty ? [] : new.components(separatedBy: "\n")
    let (prefix, suffix) = matchEdges(oldLines, newLines)

    var lines: [DiffLine] = []
    var id = 0
    func append(_ kind: DiffLineKind, _ text: String, _ oldNo: Int?, _ newNo: Int?) {
      id += 1
      lines.append(DiffLine(kind: kind, text: text, oldNumber: oldNo, newNumber: newNo, id: id))
    }

    for i in 0..<prefix {
      append(.context, oldLines[i], i + 1, i + 1)
    }
    for i in prefix..<(oldLines.count - suffix) {
      append(.remove, oldLines[i], i + 1, nil)
    }
    for i in prefix..<(newLines.count - suffix) {
      append(.add, newLines[i], nil, i + 1)
    }
    for i in 0..<suffix {
      let oldIndex = oldLines.count - suffix + i
      let newIndex = newLines.count - suffix + i
      append(.context, oldLines[oldIndex], oldIndex + 1, newIndex + 1)
    }
    return lines
  }

  /// A Write is all additions — there was nothing there before.
  public static func writeLines(_ content: String) -> [DiffLine] {
    guard !content.isEmpty else { return [] }
    return content.components(separatedBy: "\n").enumerated().map { index, text in
      DiffLine(kind: .add, text: text, oldNumber: nil, newNumber: index + 1, id: index + 1)
    }
  }

  public static func stats(old: String, new: String) -> Stats {
    let oldLines = old.isEmpty ? [] : old.components(separatedBy: "\n")
    let newLines = new.isEmpty ? [] : new.components(separatedBy: "\n")
    let (prefix, suffix) = matchEdges(oldLines, newLines)
    return Stats(
      additions: max(0, newLines.count - prefix - suffix),
      deletions: max(0, oldLines.count - prefix - suffix))
  }

  public static func writeStats(_ content: String) -> Stats {
    Stats(additions: content.isEmpty ? 0 : content.components(separatedBy: "\n").count,
          deletions: 0)
  }
}
