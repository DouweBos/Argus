import Foundation
import SwiftTreeSitter

/// The document as UTF-16 code units, which is what tree-sitter reads (`UTF16LE`) and what
/// `NSRange` counts. Byte offsets are `units * 2`; a point's column is in bytes too.
struct TextBuffer {
  private(set) var units: [UInt16]
  /// UTF-16 offset of the first unit of every line.
  private(set) var lineStarts: [Int]

  init(_ text: String) {
    units = Array(text.utf16)
    lineStarts = Self.lineStarts(of: units[...], base: 0)
  }

  var count: Int { units.count }

  func point(at offset: Int) -> Point {
    let row = line(containing: offset)
    return Point(row: row, column: (offset - lineStarts[row]) * 2)
  }

  /// Applies an edit and returns the matching tree-sitter `InputEdit`.
  mutating func replace(_ range: NSRange, with newText: String) -> InputEdit {
    let start = range.location
    let oldEnd = NSMaxRange(range)
    let startPoint = point(at: start)
    let oldEndPoint = point(at: oldEnd)
    let inserted = Array(newText.utf16)
    units.replaceSubrange(start..<oldEnd, with: inserted)

    let delta = inserted.count - range.length
    let firstAffected = line(containing: start) + 1
    var tail = lineStarts[firstAffected...].drop { $0 <= oldEnd }.map { $0 + delta }
    let added = Self.lineStarts(of: inserted[...], base: start).dropFirst()
    tail.insert(contentsOf: added, at: 0)
    lineStarts.replaceSubrange(firstAffected..., with: tail)

    let newEnd = start + inserted.count
    return InputEdit(
      startByte: start * 2, oldEndByte: oldEnd * 2, newEndByte: newEnd * 2,
      startPoint: startPoint, oldEndPoint: oldEndPoint, newEndPoint: point(at: newEnd))
  }

  func string(_ range: NSRange) -> String {
    let lower = max(0, min(range.location, units.count))
    let upper = max(lower, min(NSMaxRange(range), units.count))
    return String(decoding: units[lower..<upper], as: UTF16.self)
  }

  /// tree-sitter's read callback: up to 4 KB of UTF-16LE from a byte offset.
  func chunk(atByte byteOffset: Int) -> Data? {
    let start = byteOffset / 2
    guard start < units.count else { return nil }
    let end = min(start + 2048, units.count)
    return units[start..<end].withUnsafeBytes { Data($0) }
  }

  private func line(containing offset: Int) -> Int {
    var low = 0
    var high = lineStarts.count - 1
    while low < high {
      let mid = (low + high + 1) / 2
      if lineStarts[mid] <= offset { low = mid } else { high = mid - 1 }
    }
    return low
  }

  /// Line starts within `slice`, offset by `base`; always begins with `base`.
  private static func lineStarts(of slice: ArraySlice<UInt16>, base: Int) -> [Int] {
    var starts = [base]
    var offset = base
    for unit in slice {
      offset += 1
      if unit == 0x0A { starts.append(offset) }
    }
    return starts
  }
}
