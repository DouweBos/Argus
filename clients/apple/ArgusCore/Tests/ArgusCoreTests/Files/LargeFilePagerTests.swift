import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
@Suite("Large file pager")
struct LargeFilePagerTests {
  /// Pages of `text` the way the host cuts them: on the last line break that fits.
  private func pager(_ text: String, pageBytes: Int) -> LargeFilePager {
    let bytes = Array(text.utf8)
    return LargeFilePager(size: bytes.count, pageBytes: pageBytes) { offset, length in
      let slice = bytes[offset..<min(bytes.count, offset + length)]
      var cut = slice.count
      if offset + cut < bytes.count, let newline = slice.lastIndex(of: 0x0A) { cut = newline - offset + 1 }
      let page = String(decoding: bytes[offset..<offset + cut], as: UTF8.self)
      return ArgusProtocol.CodeFileRange(text: page, offset: offset, end: offset + cut, size: bytes.count, binary: false)
    }
  }

  @Test func numbersLinesAcrossPages() async {
    let pager = pager("one\ntwo\nthree\nfour\n", pageBytes: 9)
    await pager.start()
    #expect(pager.page?.lines == ["one", "two"])
    #expect(pager.page?.firstLine == 1)
    #expect(!pager.hasPrevious && pager.hasNext)
    await pager.next()
    #expect(pager.page?.lines == ["three"])
    #expect(pager.page?.firstLine == 3)
    await pager.next()
    #expect(pager.page?.lines == ["four"])
    #expect(pager.page?.firstLine == 4)
    #expect(!pager.hasNext)
    #expect(pager.progress == 1)
    await pager.previous()
    await pager.previous()
    #expect(pager.page?.firstLine == 1)
    #expect(!pager.hasPrevious)
  }

  @Test func dropsCarriageReturns() {
    let page = LargeFilePager.page(
      .init(text: "a\r\nb\r\n", offset: 0, end: 6, size: 6, binary: false), firstLine: 1)
    #expect(page.lines == ["a", "b"])
  }

  @Test func binaryPagesShowNothing() async {
    let pager = LargeFilePager(size: 10) { offset, _ in
      .init(text: "", offset: offset, end: offset, size: 10, binary: true)
    }
    await pager.start()
    #expect(pager.isBinary)
    #expect(pager.page == nil)
  }
}
