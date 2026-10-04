import ArgusCore
import Foundation
import Testing

struct TerminalTextTests {
  private func text(_ chunks: [String], limit: Int = 1024) -> TerminalText {
    var text = TerminalText(limit: limit)
    for chunk in chunks { text.append(Data(chunk.utf8)) }
    return text
  }

  @Test func dropsColoursAndTitles() {
    #expect(text(["\u{1B}[32mready\u{1B}[0m on :3000\r\n", "\u{1B}]0;title\u{07}ok\n"]).text
      == "ready on :3000\nok\n")
  }

  @Test func holdsAnEscapeSplitAcrossChunks() {
    #expect(text(["a\u{1B}[3", "2mb\u{1B}", "[0mc"]).text == "abc")
  }

  @Test func holdsACharacterSplitAcrossChunks() {
    var text = TerminalText()
    let bytes = Data("é✓".utf8)
    text.append(bytes.prefix(3))
    text.append(bytes.suffix(from: 3))
    #expect(text.text == "é✓")
  }

  @Test func aBareCarriageReturnRedrawsTheLine() {
    #expect(text(["done\n10%", "\r50%\r", "\n"]).text == "done\n50%\n")
  }

  @Test func keepsTheTailFromALineStart() {
    let long = text([String(repeating: "x", count: 30) + "\n" + "tail\n"], limit: 10)
    #expect(long.text == "tail\n")
    #expect(long.truncated)
  }
}
