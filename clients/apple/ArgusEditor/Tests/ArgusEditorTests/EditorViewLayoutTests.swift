import AppKit
import SwiftUI
import XCTest

@testable import ArgusEditor

/// The editor hosted in a real window, next to other panes, like the code view lays it out.
@MainActor
final class EditorViewLayoutTests: XCTestCase {
  private var window: NSWindow?

  override func tearDown() async throws {
    window?.close()
    window = nil
  }

  private func longText(lines: Int = 120) -> String {
    var rows = (0..<lines).map { "  \"key\($0)\": \"value \($0)\"," }
    rows[5] = "  \"long\": \"" + String(repeating: "abcdefghij", count: 40) + "\","
    return "{\n" + rows.joined(separator: "\n") + "\n}\n"
  }

  /// A navigator on the left and a header above, as in the app's code view.
  private func host(_ document: EditorDocument) -> NSView {
    _ = NSApplication.shared
    let root = HStack(spacing: 0) {
      Color.red.frame(width: 200)
      VStack(spacing: 0) {
        Color.blue.frame(height: 30)
        CodeEditorView(document: document)
      }
    }
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 900, height: 600), styleMask: [.titled, .fullSizeContentView, .resizable],
      backing: .buffered, defer: false)
    window.titlebarAppearsTransparent = true
    window.isReleasedWhenClosed = false
    let hosting = NSHostingView(rootView: root)
    window.contentView = hosting
    self.window = window
    settle(hosting)
    return hosting
  }

  private func settle(_ view: NSView) {
    view.layoutSubtreeIfNeeded()
    RunLoop.main.run(until: Date().addingTimeInterval(0.05))
    view.layoutSubtreeIfNeeded()
  }

  private func scroll(_ document: EditorDocument, to point: NSPoint) {
    let clip = document.engine.scrollView.contentView
    clip.scroll(to: point)
    document.engine.scrollView.reflectScrolledClipView(clip)
  }

  private func container(_ document: EditorDocument) throws -> NSView {
    try XCTUnwrap(document.engine.scrollView.superview)
  }

  func testGutterSitsAtTheEditorsLeadingEdgeInsideItsBounds() throws {
    let document = EditorDocument(text: longText(), language: nil, configuration: .default)
    let hosting = host(document)
    let container = try container(document)
    for offset in [CGFloat(0), 400] {
      scroll(document, to: NSPoint(x: 0, y: offset))
      settle(hosting)
      let gutter = document.gutter.convert(document.gutter.bounds, to: container)
      XCTAssertEqual(gutter.minX, 0, accuracy: 0.5, "flush with the editor's left edge at y \(offset)")
      XCTAssertEqual(gutter.minY, 0, accuracy: 0.5)
      XCTAssertTrue(container.bounds.contains(gutter), "\(gutter) inside \(container.bounds)")
      XCTAssertTrue(container.clipsToBounds && document.gutter.clipsToBounds)
    }
  }

  func testGutterRowsMatchTheVisibleLines() throws {
    let document = EditorDocument(text: longText(), language: nil, configuration: .default)
    let hosting = host(document)
    for offset in [CGFloat(0), 437] {
      scroll(document, to: NSPoint(x: 0, y: offset))
      settle(hosting)
      let textView = document.engine.textView
      let layout = try XCTUnwrap(textView.layoutManager)
      let first = try XCTUnwrap(layout.textLineForPosition(textView.visibleRect.minY))
      let rows = document.gutter.rows(in: document.gutter.bounds)
      let row = try XCTUnwrap(rows.first)
      XCTAssertEqual(row.line.index, first.index, "first number is the first visible line at y \(offset)")
      // Each row sits where its line is drawn, relative to the viewport.
      XCTAssertEqual(row.y, first.yPos - textView.visibleRect.minY, accuracy: 0.5)
      XCTAssertGreaterThan(rows.count, 10)
    }
  }

  func testGutterStaysPutWhenTheTextScrollsSideways() throws {
    let document = EditorDocument(text: longText(), language: nil, configuration: .default)
    let hosting = host(document)
    scroll(document, to: NSPoint(x: 400, y: 0))
    settle(hosting)
    XCTAssertEqual(document.engine.scrollView.contentView.bounds.minX, 400, accuracy: 0.5)
    let gutter = document.gutter.convert(document.gutter.bounds, to: try container(document))
    XCTAssertEqual(gutter.minX, 0, accuracy: 0.5)
  }

  func testLongLinesWidenTheTextViewWhenNotWrapping() {
    let document = EditorDocument(text: longText(), language: nil, configuration: .default)
    _ = host(document)
    let engine = document.engine
    XCTAssertGreaterThan(engine.textView.frame.width, engine.scrollView.contentSize.width + 1000)
    XCTAssertTrue(engine.scrollView.hasHorizontalScroller)

    var wrapped = EditorConfiguration.default
    wrapped.wrapLines = true
    document.configuration = wrapped
    settle(engine.scrollView)
    XCTAssertEqual(engine.textView.frame.width, engine.scrollView.contentSize.width, accuracy: 0.5)
    XCTAssertFalse(engine.scrollView.hasHorizontalScroller)
  }

  func testCaretMovesScrollSideways() throws {
    let document = EditorDocument(text: longText(), language: nil, configuration: .default)
    let hosting = host(document)
    let textView = document.engine.textView
    textView.window?.makeFirstResponder(textView)
    let longLine = document.lineIndex.lineRange(6)
    textView.selectionManager.setSelectedRange(NSRange(location: longLine.location, length: 0))
    textView.moveToRightEndOfLine(nil)
    settle(hosting)
    XCTAssertGreaterThan(document.engine.scrollView.contentView.bounds.minX, 1000, "⌘→ follows the caret")
    textView.moveToLeftEndOfLine(nil)
    settle(hosting)
    let offset = try XCTUnwrap(textView.selectionManager.textSelections.first?.range.location)
    let caret = try XCTUnwrap(textView.layoutManager.rectForOffset(offset))
    let clipX = document.engine.scrollView.contentView.bounds.minX
    XCTAssertGreaterThanOrEqual(caret.minX - clipX, document.gutter.frame.width, "⌘← brings the caret back clear of the gutter")
  }
}
