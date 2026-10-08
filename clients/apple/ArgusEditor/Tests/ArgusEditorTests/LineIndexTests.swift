import Foundation
import XCTest

@testable import ArgusEditor

final class LineIndexTests: XCTestCase {
  func testLineBreaksFollowLSP() {
    let text = "a\r\nb\rc\nd" as NSString
    let index = LineIndex(text)
    XCTAssertEqual(index.starts, [0, 3, 5, 7])
    XCTAssertEqual(index.position(of: 1), EditorPosition(line: 0, utf16Column: 1))
    XCTAssertEqual(index.position(of: 3), EditorPosition(line: 1, utf16Column: 0))
    XCTAssertEqual(index.offset(of: EditorPosition(line: 0, utf16Column: 99), in: text), 1, "clamped before CRLF")
    XCTAssertEqual(index.offset(of: EditorPosition(line: 3, utf16Column: 1), in: text), 8)
    XCTAssertEqual(index.offset(of: EditorPosition(line: 9, utf16Column: 0), in: text), 8)
  }

  func testEmojiColumnsAreUTF16() {
    let text = "let 👍🏽 = 1\nnext" as NSString
    let index = LineIndex(text)
    let equals = text.range(of: "=").location
    XCTAssertEqual(index.position(of: equals), EditorPosition(line: 0, utf16Column: 9))
    XCTAssertEqual(index.offset(of: EditorPosition(line: 0, utf16Column: 9), in: text), equals)
  }

  func testIncrementalEditsMatchARebuild() {
    var generator = SeededGenerator(seed: 42)
    let alphabet = ["a", "b", "\n", "\r", "\r\n", "👍", " ", ""]
    let text = NSMutableString(string: "one\r\ntwo\nthree\rfour")
    var index = LineIndex(text)
    for _ in 0..<3000 {
      let location = Int.random(in: 0...text.length, using: &generator)
      let length = Int.random(in: 0...min(3, text.length - location), using: &generator)
      var range = NSRange(location: location, length: length)
      // Never split a surrogate pair.
      range = text.rangeOfComposedCharacterSequences(for: range)
      let insert = (0..<Int.random(in: 0...3, using: &generator)).map { _ in alphabet.randomElement(using: &generator)! }.joined()
      text.replaceCharacters(in: range, with: insert)
      index.apply(location: range.location, oldLength: range.length, newLength: (insert as NSString).length, text: text)
      XCTAssertEqual(index, LineIndex(text), "after replacing \(range) with \(insert.debugDescription) in \(text.debugDescription)")
      if index != LineIndex(text) { return }
    }
  }
}

struct SeededGenerator: RandomNumberGenerator {
  private var state: UInt64
  init(seed: UInt64) { state = seed }
  mutating func next() -> UInt64 {
    state &+= 0x9E37_79B9_7F4A_7C15
    var z = state
    z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
    z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
    return z ^ (z >> 31)
  }
}
