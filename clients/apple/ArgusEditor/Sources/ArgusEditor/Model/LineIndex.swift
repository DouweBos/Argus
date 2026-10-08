import Foundation

/// UTF-16 offsets of every line start, kept in step with the buffer edit by edit.
///
/// Line breaks are LSP's: `\n`, `\r\n` and a lone `\r`. Positions are 0-based
/// line + UTF-16 column, so they go to a language server untranslated.
struct LineIndex: Equatable {
  private(set) var starts: [Int] = [0]
  private(set) var length = 0

  init() {}

  init(_ text: NSString) {
    length = text.length
    starts = [0]
    Self.scan(text, from: 0, to: length) { starts.append($0) }
  }

  var lineCount: Int { starts.count }

  /// The line holding `offset`; an offset on a line break belongs to the line it ends.
  func line(containing offset: Int) -> Int {
    let offset = min(max(0, offset), length)
    var low = 0
    var high = starts.count - 1
    while low < high {
      let mid = (low + high + 1) / 2
      if starts[mid] <= offset { low = mid } else { high = mid - 1 }
    }
    return low
  }

  func position(of offset: Int) -> EditorPosition {
    let offset = min(max(0, offset), length)
    let line = line(containing: offset)
    return EditorPosition(line: line, utf16Column: offset - starts[line])
  }

  /// Clamps past-the-end columns to the line's content and past-the-end lines to the document end.
  func offset(of position: EditorPosition, in text: NSString) -> Int {
    guard position.line >= 0 else { return 0 }
    guard position.line < starts.count else { return length }
    let start = starts[position.line]
    return start + min(max(0, position.utf16Column), contentLength(ofLine: position.line, in: text))
  }

  func range(_ range: EditorRange, in text: NSString) -> NSRange {
    let a = offset(of: range.start, in: text)
    let b = offset(of: range.end, in: text)
    return NSRange(location: min(a, b), length: abs(b - a))
  }

  func editorRange(_ range: NSRange) -> EditorRange {
    EditorRange(start: position(of: range.location), end: position(of: NSMaxRange(range)))
  }

  /// The line's range including its line break.
  func lineRange(_ line: Int) -> NSRange {
    guard line >= 0, line < starts.count else { return NSRange(location: length, length: 0) }
    let end = line + 1 < starts.count ? starts[line + 1] : length
    return NSRange(location: starts[line], length: end - starts[line])
  }

  func contentLength(ofLine line: Int, in text: NSString) -> Int {
    let range = lineRange(line)
    var length = range.length
    while length > 0 {
      let c = text.character(at: range.location + length - 1)
      guard c == 0x0A || c == 0x0D else { break }
      length -= 1
    }
    return length
  }

  /// Updates for `text` (already edited) where `oldLength` UTF-16 units at `location` became `newLength`.
  mutating func apply(location: Int, oldLength: Int, newLength: Int, text: NSString) {
    let delta = newLength - oldLength
    // A line break right before or after the edit can pair up (`\r` + `\n`) or split, so its start is rescanned too.
    let removeLow = max(location, 1)
    let removeHigh = location + oldLength + 1
    let first = lowerBound(removeLow)
    let last = lowerBound(removeHigh + 1)
    var rescanned: [Int] = []
    let scanFrom = max(location - 1, 0)
    let scanTo = min(location + newLength + 1, text.length)
    if scanFrom < scanTo {
      Self.scan(text, from: scanFrom, to: scanTo) { start in
        if start >= removeLow { rescanned.append(start) }
      }
    }
    let tail = starts[last...].map { $0 + delta }
    starts.replaceSubrange(first..., with: rescanned + tail)
    length = text.length
  }

  private func lowerBound(_ value: Int) -> Int {
    var low = 0
    var high = starts.count
    while low < high {
      let mid = (low + high) / 2
      if starts[mid] < value { low = mid + 1 } else { high = mid }
    }
    return low
  }

  /// Calls `found` with the start offset of every line that begins after a break found in `from..<to`.
  static func scan(_ text: NSString, from: Int, to: Int, found: (Int) -> Void) {
    let total = text.length
    let chunk = 4096
    var buffer = [unichar](repeating: 0, count: chunk + 1)
    var location = from
    while location < to {
      let count = min(chunk, to - location)
      // One extra unit of lookahead decides whether a `\r` pairs with a `\n`.
      let read = min(count + 1, total - location)
      text.getCharacters(&buffer, range: NSRange(location: location, length: read))
      for i in 0..<count {
        let c = buffer[i]
        if c == 0x0A {
          found(location + i + 1)
        } else if c == 0x0D {
          let next: unichar? = i + 1 < read ? buffer[i + 1] : nil
          if next != 0x0A { found(location + i + 1) }
        }
      }
      location += count
    }
  }
}
