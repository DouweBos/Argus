import AppKit
import XCTest

@testable import ArgusEditor

/// M0's budget for the engine. Numbers are printed so a run can be
/// recorded; assertions use generous multiples so CI noise doesn't fail them.
@MainActor
final class PerformanceTests: XCTestCase {
  func testFiftyThousandLineTypeScript() async throws {
    let text = Fixtures.typescript(lines: 50_000)
    let rss0 = Fixtures.residentBytes()

    let openStart = CACurrentMediaTime()
    let document = EditorDocument(text: text, language: .typescript, configuration: .default)
    let host = EditorTestHost(document)
    let openMs = (CACurrentMediaTime() - openStart) * 1000
    await document.highlighter.settle()
    let firstPaintMs = (CACurrentMediaTime() - openStart) * 1000
    let rssMB = Double(Fixtures.residentBytes() - rss0) / 1e6
    XCTAssertEqual(document.highlightStatus, .highlighted(.typescript))

    // Typing: the synchronous keystroke (insert + layout), then the main-thread cost of applying
    // its highlight (attribute paint + the relayout it causes). Parse and query run off the main actor.
    let textView = document.engine.textView
    let caret = document.offset(of: .init(line: 1_000, utf16Column: 10))
    textView.selectionManager.setSelectedRange(NSRange(location: caret, length: 0))
    document.engine.center(NSRange(location: caret, length: 0))
    textView.layout()
    var keystrokeMs: [Double] = []
    var mainThreadMs: [Double] = []
    var roundTripMs: [Double] = []
    for i in 0..<200 {
      let start = CACurrentMediaTime()
      if i % 25 == 24 {
        textView.doCommand(by: #selector(NSResponder.insertNewline(_:)))
      } else {
        textView.insertText(i % 5 == 0 ? " " : "x", replacementRange: NSRange(location: NSNotFound, length: 0))
      }
      textView.layout()
      let keystroke = (CACurrentMediaTime() - start) * 1000
      let paints = document.highlighter.paintCount
      await document.highlighter.settle()
      var paint = 0.0
      if document.highlighter.paintCount > paints {
        let relayout = CACurrentMediaTime()
        textView.layout()
        paint = (document.highlighter.lastPaintDuration + CACurrentMediaTime() - relayout) * 1000
      }
      keystrokeMs.append(keystroke)
      mainThreadMs.append(keystroke + paint)
      roundTripMs.append((CACurrentMediaTime() - start) * 1000)
    }

    // Scrolling the whole file a viewport at a time, highlighting each stop.
    let scrollView = document.engine.scrollView
    let viewport = scrollView.contentSize.height
    var scrollMs: [Double] = []
    var y: CGFloat = 0
    while y < textView.frame.height - viewport {
      let start = CACurrentMediaTime()
      scrollView.contentView.scroll(to: NSPoint(x: 0, y: y))
      textView.layout()
      scrollMs.append((CACurrentMediaTime() - start) * 1000)
      y += viewport
    }

    // The same again, a jump at a time, with the highlight for each stop painted before moving on.
    var scrollPaintMs: [Double] = []
    var queryMs: [Double] = []
    y = 0
    while y < textView.frame.height - viewport {
      let start = CACurrentMediaTime()
      scrollView.contentView.scroll(to: NSPoint(x: 0, y: y))
      textView.layout()
      let scroll = CACurrentMediaTime() - start
      let paints = document.highlighter.paintCount
      let queryStart = CACurrentMediaTime()
      await document.highlighter.settle()
      if document.highlighter.paintCount > paints {
        queryMs.append((CACurrentMediaTime() - queryStart) * 1000)
        let relayout = CACurrentMediaTime()
        textView.layout()
        scrollPaintMs.append((scroll + document.highlighter.lastPaintDuration + CACurrentMediaTime() - relayout) * 1000)
      }
      y += viewport * 7
    }

    print(
      """
      M0 50k-line TS: open+first layout \(fmt(openMs)) ms, first highlight \(fmt(firstPaintMs)) ms, memory +\(fmt(rssMB)) MB
      typing (insert+layout) p50 \(fmt(p(keystrokeMs, 0.5))) p95 \(fmt(p(keystrokeMs, 0.95))) ms; \
      main thread incl. highlight paint p50 \(fmt(p(mainThreadMs, 0.5))) p95 \(fmt(p(mainThreadMs, 0.95))) ms; \
      keystroke→recoloured p50 \(fmt(p(roundTripMs, 0.5))) p95 \(fmt(p(roundTripMs, 0.95))) ms
      scroll \(scrollMs.count) viewports: p50 \(fmt(p(scrollMs, 0.5))) p95 \(fmt(p(scrollMs, 0.95))) max \(fmt(scrollMs.max() ?? 0)) ms
      scroll + highlight paint (\(scrollPaintMs.count) jumps): main thread p50 \(fmt(p(scrollPaintMs, 0.5))) p95 \(fmt(p(scrollPaintMs, 0.95))) ms; \
      off-main query p50 \(fmt(p(queryMs, 0.5))) p95 \(fmt(p(queryMs, 0.95))) ms
      """)
    XCTAssertLessThan(openMs, 300 * 3)
    XCTAssertLessThan(p(mainThreadMs, 0.95), 16 * 2)
    XCTAssertLessThan(p(scrollMs, 0.95), 16 * 2)
    _ = host
  }

  private func p(_ values: [Double], _ q: Double) -> Double {
    let sorted = values.sorted()
    guard !sorted.isEmpty else { return 0 }
    return sorted[min(sorted.count - 1, Int(Double(sorted.count) * q))]
  }

  private func fmt(_ value: Double) -> String { String(format: "%.1f", value) }
}
