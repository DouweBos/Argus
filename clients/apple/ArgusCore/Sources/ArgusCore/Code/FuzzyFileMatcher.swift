import Foundation

/// Quick-open matching over a session's relative paths, fzf style: the query is a
/// case-insensitive subsequence of the path; matches in the file name, at word boundaries
/// (`/`, `_`, `-`, `.`, camelCase) and in runs score higher. Build once per file list, then
/// `search` per keystroke.
public struct FuzzyFileMatcher: Sendable {
  public struct Match: Sendable, Equatable {
    public let path: String
    public let score: Int
    /// UTF-16 offsets into `path` of the matched characters, for highlighting.
    public let indices: [Int]
    public let isBoosted: Bool
  }

  public let paths: [String]
  /// Every path's UTF-16 units, back to back; `starts[i]..<starts[i + 1]` is path `i`.
  private let units: [UInt16]
  private let starts: [Int]
  /// Offset of each path's file name within it.
  private let baseOffsets: [Int]

  public init(paths: [String]) {
    self.paths = paths
    var units: [UInt16] = []
    var starts: [Int] = [0]
    var baseOffsets: [Int] = []
    units.reserveCapacity(paths.count * 48)
    starts.reserveCapacity(paths.count + 1)
    baseOffsets.reserveCapacity(paths.count)
    for path in paths {
      var base = 0
      var offset = 0
      for unit in path.utf16 {
        units.append(unit)
        offset += 1
        if unit == Self.slash { base = offset }
      }
      starts.append(units.count)
      baseOffsets.append(base)
    }
    self.units = units
    self.starts = starts
    self.baseOffsets = baseOffsets
  }

  /// Best matches first, at most `limit`. Paths in `boost` (changed files) rank above the rest.
  /// An empty query lists boosted paths first, then the others in their original order.
  public func search(_ query: String, boost: Set<String> = [], limit: Int = 50) -> [Match] {
    let needle = Self.fold(query.utf16.filter { $0 != Self.space })
    guard !needle.isEmpty else {
      let boosted = paths.filter { boost.contains($0) }
      let rest = paths.lazy.filter { !boost.contains($0) }
      return (boosted + rest.prefix(max(0, limit - boosted.count))).prefix(limit).map {
        Match(path: $0, score: 0, indices: [], isBoosted: boost.contains($0))
      }
    }
    var scored: [(index: Int, score: Int)] = []
    units.withUnsafeBufferPointer { all in
      for index in paths.indices {
        let path = UnsafeBufferPointer(rebasing: all[starts[index]..<starts[index + 1]])
        guard var score = Self.score(needle, in: path, baseOffset: baseOffsets[index])?.score else {
          continue
        }
        if !boost.isEmpty, boost.contains(paths[index]) { score += Self.boostBonus }
        scored.append((index, score))
      }
    }
    scored.sort { $0.score != $1.score ? $0.score > $1.score : $0.index < $1.index }
    return scored.prefix(limit).map { entry in
      let path = paths[entry.index]
      let units = Array(path.utf16)
      let indices = units.withUnsafeBufferPointer {
        Self.score(needle, in: $0, baseOffset: baseOffsets[entry.index])?.indices ?? []
      }
      return Match(
        path: path, score: entry.score, indices: indices, isBoosted: entry.score >= Self.boostBonus)
    }
  }

  /// One path against one query, for callers that don't keep an index.
  public static func match(_ query: String, path: String) -> (score: Int, indices: [Int])? {
    let needle = fold(query.utf16.filter { $0 != space })
    let units = Array(path.utf16)
    let base = (units.lastIndex(of: slash) ?? -1) + 1
    return units.withUnsafeBufferPointer { score(needle, in: $0, baseOffset: base) }
  }

  // MARK: - Scoring

  private static let slash: UInt16 = 0x2F
  private static let space: UInt16 = 0x20
  private static let boostBonus = 1 << 40

  private static func score(
    _ needle: [UInt16], in path: UnsafeBufferPointer<UInt16>, baseOffset: Int
  ) -> (score: Int, indices: [Int])? {
    guard !needle.isEmpty else { return (0, []) }
    // A match inside the file name beats the same letters spread over directories.
    if baseOffset > 0, let inName = window(needle, in: path, from: baseOffset) {
      let indices = pick(needle, in: path, window: inName)
      return (rate(indices, in: path, baseOffset: baseOffset), indices)
    }
    guard let whole = window(needle, in: path, from: 0) else { return nil }
    let indices = pick(needle, in: path, window: whole)
    return (rate(indices, in: path, baseOffset: baseOffset), indices)
  }

  /// The shortest stretch ending at the first complete match (fzf's v1 forward/backward scan).
  private static func window(
    _ needle: [UInt16], in path: UnsafeBufferPointer<UInt16>, from start: Int
  ) -> ClosedRange<Int>? {
    var j = 0
    var end = -1
    var i = start
    while i < path.count {
      if fold(path[i]) == needle[j] {
        j += 1
        if j == needle.count {
          end = i
          break
        }
      }
      i += 1
    }
    guard end >= 0 else { return nil }
    j = needle.count - 1
    var begin = end
    while begin >= start {
      if fold(path[begin]) == needle[j] {
        if j == 0 { break }
        j -= 1
      }
      begin -= 1
    }
    return begin...end
  }

  private static func pick(
    _ needle: [UInt16], in path: UnsafeBufferPointer<UInt16>, window: ClosedRange<Int>
  ) -> [Int] {
    var indices: [Int] = []
    indices.reserveCapacity(needle.count)
    var j = 0
    for i in window where j < needle.count && fold(path[i]) == needle[j] {
      indices.append(i)
      j += 1
    }
    return indices
  }

  private static func rate(_ indices: [Int], in path: UnsafeBufferPointer<UInt16>, baseOffset: Int)
    -> Int
  {
    var score = 0
    var previous = -2
    var streak = 0
    for index in indices {
      score += 16
      score += boundaryBonus(at: index, in: path)
      if index == previous + 1 {
        streak += 1
        score += 4 * min(streak, 4)
      } else {
        streak = 0
        if previous >= 0 { score -= min(index - previous - 1, 12) }
      }
      previous = index
    }
    if let first = indices.first, first >= baseOffset {
      score += 24
      if first == baseOffset { score += 12 }
      if indices.count == path.count - baseOffset { score += 24 }
    }
    // Ties go to the shorter path.
    return score * 1024 - path.count
  }

  private static func boundaryBonus(at index: Int, in path: UnsafeBufferPointer<UInt16>) -> Int {
    guard index > 0 else { return 10 }
    let previous = path[index - 1]
    switch previous {
    case slash: return 10
    case 0x5F, 0x2D, 0x2E, space: return 8  // _ - . space
    default:
      let isLower = previous >= 0x61 && previous <= 0x7A
      let isUpper = path[index] >= 0x41 && path[index] <= 0x5A
      return isLower && isUpper ? 7 : 0
    }
  }

  private static func fold(_ unit: UInt16) -> UInt16 {
    unit >= 0x41 && unit <= 0x5A ? unit | 0x20 : unit
  }

  private static func fold(_ units: [UInt16]) -> [UInt16] { units.map(fold) }
}
