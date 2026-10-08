import Foundation

/// How an external change maps onto the buffer: the one replacement to make, where
/// every old line ends up, and which new lines are actually new (to flash).
struct ReloadPlan {
  /// In the old text.
  var replaceRange: NSRange
  var replacement: String
  /// The new lines that differ from the old text, coalesced.
  var changedLines: [Range<Int>]
  private var regionStart = 0
  private var oldRegionEnd = 0
  private var lineDelta = 0
  private var regionMap: [Int] = []

  init(old: NSString, new: NSString, oldIndex: LineIndex, newIndex: LineIndex) {
    let prefix = Self.commonPrefix(old, new)
    let suffix = Self.commonSuffix(old, new, limit: min(old.length, new.length) - prefix)
    replaceRange = NSRange(location: prefix, length: old.length - suffix - prefix)
    replacement = new.substring(with: NSRange(location: prefix, length: new.length - suffix - prefix))
    changedLines = []
    guard replaceRange.length > 0 || !replacement.isEmpty else { return }

    let first = oldIndex.line(containing: prefix)
    let oldLast = oldIndex.line(containing: old.length - suffix)
    let newLast = newIndex.line(containing: new.length - suffix)
    regionStart = first
    oldRegionEnd = oldLast
    lineDelta = newLast - oldLast

    let oldLines = (first...oldLast).map { old.substring(with: oldIndex.lineRange($0)) }
    let newLines = (first...newLast).map { new.substring(with: newIndex.lineRange($0)) }
    let diff = newLines.difference(from: oldLines)
    var removed = Set<Int>()
    var inserted = Set<Int>()
    for change in diff {
      switch change {
      case .remove(let offset, _, _): removed.insert(offset)
      case .insert(let offset, _, _): inserted.insert(offset)
      }
    }
    // Walk both sides in step: kept lines pair up, a removed line lands where the walk is in the new text.
    var map: [Int] = []
    map.reserveCapacity(oldLines.count)
    var newCursor = 0
    for oldOffset in 0..<oldLines.count {
      while inserted.contains(newCursor) { newCursor += 1 }
      map.append(min(newCursor, newLines.count - 1))
      if !removed.contains(oldOffset) { newCursor += 1 }
    }
    regionMap = map
    changedLines = Self.coalesce(inserted.sorted().map { $0 + first })
  }

  func mapLine(_ line: Int) -> Int {
    if line < regionStart { return line }
    if line > oldRegionEnd { return line + lineDelta }
    let offset = line - regionStart
    return offset < regionMap.count ? regionStart + regionMap[offset] : line + lineDelta
  }

  private static func coalesce(_ lines: [Int]) -> [Range<Int>] {
    var ranges: [Range<Int>] = []
    for line in lines {
      if let last = ranges.last, last.upperBound == line {
        ranges[ranges.count - 1] = last.lowerBound..<(line + 1)
      } else {
        ranges.append(line..<(line + 1))
      }
    }
    return ranges
  }

  static func commonPrefix(_ a: NSString, _ b: NSString) -> Int {
    let limit = min(a.length, b.length)
    let chunk = 4096
    var bufA = [unichar](repeating: 0, count: chunk)
    var bufB = [unichar](repeating: 0, count: chunk)
    var location = 0
    while location < limit {
      let count = min(chunk, limit - location)
      a.getCharacters(&bufA, range: NSRange(location: location, length: count))
      b.getCharacters(&bufB, range: NSRange(location: location, length: count))
      for i in 0..<count where bufA[i] != bufB[i] { return adjustBackward(a, location + i) }
      location += count
    }
    return adjustBackward(a, limit)
  }

  static func commonSuffix(_ a: NSString, _ b: NSString, limit: Int) -> Int {
    let chunk = 4096
    var bufA = [unichar](repeating: 0, count: chunk)
    var bufB = [unichar](repeating: 0, count: chunk)
    var matched = 0
    while matched < limit {
      let count = min(chunk, limit - matched)
      a.getCharacters(&bufA, range: NSRange(location: a.length - matched - count, length: count))
      b.getCharacters(&bufB, range: NSRange(location: b.length - matched - count, length: count))
      for i in stride(from: count - 1, through: 0, by: -1) where bufA[i] != bufB[i] {
        return adjustForward(a, matched + (count - 1 - i))
      }
      matched += count
    }
    return adjustForward(a, limit)
  }

  /// Never split a surrogate pair or a `\r\n` at the prefix boundary.
  private static func adjustBackward(_ s: NSString, _ prefix: Int) -> Int {
    guard prefix > 0, prefix < s.length else { return prefix }
    let previous = s.character(at: prefix - 1)
    if UTF16.isLeadSurrogate(previous) || (previous == 0x0D && s.character(at: prefix) == 0x0A) {
      return prefix - 1
    }
    return prefix
  }

  private static func adjustForward(_ s: NSString, _ suffix: Int) -> Int {
    let boundary = s.length - suffix
    guard suffix > 0, boundary > 0 else { return suffix }
    let next = s.character(at: boundary)
    if UTF16.isTrailSurrogate(next) || (next == 0x0A && s.character(at: boundary - 1) == 0x0D) {
      return suffix - 1
    }
    return suffix
  }
}
