import Foundation

/// A terminal's output as plain text, built up from raw PTY chunks: escape
/// sequences dropped, a bare carriage return redrawing its line the way a
/// progress bar means it to. Colours stay with the desktop.
public struct TerminalText: Equatable, Sendable {
  public private(set) var text = ""
  /// Older output was dropped, here or by the host's capture.
  public var truncated = false

  /// Bytes of a UTF-8 character or escape sequence split across chunks.
  private var pending = Data()
  private let limit: Int

  public init(limit: Int = 64 * 1024) {
    self.limit = limit
  }

  public mutating func reset() {
    text = ""
    truncated = false
    pending = Data()
  }

  public mutating func append(_ data: Data) {
    var bytes = pending + data
    pending = Data()
    // Hold back an incomplete trailing UTF-8 sequence.
    var split = bytes.endIndex
    for offset in stride(from: 1, through: min(3, bytes.count), by: 1) {
      let byte = bytes[bytes.endIndex - offset]
      if byte & 0xC0 == 0x80 { continue }
      let need = byte >= 0xF0 ? 4 : byte >= 0xE0 ? 3 : byte >= 0xC0 ? 2 : 1
      if need > offset { split = bytes.endIndex - offset }
      break
    }
    pending = Data(bytes[split...])
    bytes = Data(bytes[..<split])
    write(String(decoding: bytes, as: UTF8.self))
  }

  private mutating func write(_ chunk: String) {
    var scalars = Array(chunk.unicodeScalars)
    var index = 0
    var out = String.UnicodeScalarView()
    while index < scalars.count {
      let scalar = scalars[index]
      switch scalar {
      case "\u{1B}":
        guard let end = Self.escapeEnd(scalars, from: index) else {
          // Unfinished: keep it for the next chunk.
          pending = Data(String(String.UnicodeScalarView(scalars[index...])).utf8) + pending
          scalars.removeSubrange(index...)
          continue
        }
        index = end
      case "\r":
        if index + 1 < scalars.count, scalars[index + 1] == "\n" {
          out.append("\n")
          index += 2
        } else if index + 1 == scalars.count {
          // Can't tell a CRLF split across chunks from a redraw yet.
          pending = Data("\r".utf8) + pending
          index += 1
        } else {
          flush(&out)
          if let newline = text.lastIndex(of: "\n") {
            text.removeSubrange(text.index(after: newline)...)
          } else {
            text = ""
          }
          index += 1
        }
      case "\u{08}":
        flush(&out)
        if let last = text.last, last != "\n" { text.removeLast() }
        index += 1
      case "\u{07}":
        index += 1
      default:
        out.append(scalar)
        index += 1
      }
    }
    flush(&out)
    trim()
  }

  private mutating func flush(_ out: inout String.UnicodeScalarView) {
    guard !out.isEmpty else { return }
    text.unicodeScalars.append(contentsOf: out)
    out = String.UnicodeScalarView()
  }

  /// Keeps the tail, from a line start.
  private mutating func trim() {
    guard text.utf8.count > limit else { return }
    let tail = text.utf8.suffix(limit)
    var kept = String(decoding: tail, as: UTF8.self)
    if let newline = kept.firstIndex(of: "\n") {
      kept = String(kept[kept.index(after: newline)...])
    }
    text = kept
    truncated = true
  }

  /// Index just past the escape sequence starting at `start`, or nil when the
  /// chunk ends inside it. CSI, OSC and two-character escapes.
  static func escapeEnd(_ s: [Unicode.Scalar], from start: Int) -> Int? {
    var i = start + 1
    guard i < s.count else { return nil }
    switch s[i] {
    case "[":
      i += 1
      while i < s.count {
        if (0x40...0x7E).contains(s[i].value) { return i + 1 }
        i += 1
      }
      return nil
    case "]":
      i += 1
      while i < s.count {
        if s[i] == "\u{07}" { return i + 1 }
        if s[i] == "\u{1B}" {
          guard i + 1 < s.count else { return nil }
          if s[i + 1] == "\\" { return i + 2 }
        }
        i += 1
      }
      return nil
    case "(", ")":
      return i + 1 < s.count ? i + 2 : nil
    default:
      return i + 1
    }
  }
}
