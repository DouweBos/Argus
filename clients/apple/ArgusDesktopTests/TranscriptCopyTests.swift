import AppKit
import ArgusCore
import ArgusUI
import Foundation
import SwiftUI
import Testing

@testable import Argus

extension WindowDrivingTests {
  /// ⌘C in the transcript copies exactly what's highlighted, however it was selected.
  @MainActor
  @Suite(.serialized)
  struct TranscriptCopyTests {
    private static let answer = """
      This crash is already known and fixed on `main`.

      **Already tracked:**
      - **Ticket:** ABC-123 (Done), error group `APP-1X9B`.
      - **Fix:** `00fb4b16b3` changes the loop to `items.toList().asReversed()`.
      """

    @Test func dragCopiesWhatItHighlights() async throws {
      let (window, view) = try await Self.transcript()
      defer { window.orderOut(nil) }
      let (start, end) = try Self.ends(of: "ABC-123", in: view)
      Self.press(window, at: start, dragTo: end, clicks: 1)
      #expect(Self.highlighted(window) == ["ABC-123"])
      #expect(Self.copy(view) == "ABC-123")
    }

    /// A word picked by a double click, then grown with ⇧→: AppKit moves the
    /// selection itself, and the copy used to keep only the word.
    @Test func keyboardExtendedWordCopiesWhatItHighlights() async throws {
      let (window, view) = try await Self.transcript()
      defer { window.orderOut(nil) }
      let (start, _) = try Self.ends(of: "ABC-123", in: view)
      window.makeFirstResponder(view)
      Self.press(window, at: start, dragTo: start, clicks: 2)
      #expect(Self.highlighted(window) == ["ABC"])
      for _ in 0..<4 { view.moveRightAndModifySelection(nil) }
      #expect(Self.highlighted(window) == ["ABC-123"])
      #expect(Self.copy(view) == "ABC-123")
    }

    // MARK: Helpers

    private static let agent = "copy"
    private static let viewer = ImageViewerState()

    /// A turn whose work folds into a log, then the answer, in the app's transcript.
    private static func transcript() async throws -> (NSWindow, TranscriptNSTextView) {
      let json: [[String: Any]] = [
        ["id": "u1", "role": "user", "text_blocks": ["Why does it crash?"], "timestamp": 1_000, "tool_calls": []],
        [
          "id": "a1", "role": "assistant", "text_blocks": ["Checking the ticket."], "timestamp": 2_000,
          "tool_calls": [
            [
              "id": "c1", "name": "Bash", "input": ["command": "ls"], "status": "done",
              "result_blocks": [["type": "text", "text": "a\nb"]],
            ]
          ],
        ],
        ["id": "a2", "role": "assistant", "text_blocks": [answer], "timestamp": 3_000, "tool_calls": []],
      ]
      let messages = try JSONDecoder().decode(
        [RemoteMessage].self, from: JSONSerialization.data(withJSONObject: json))
      let root = TranscriptView(agentKey: agent, sessionId: "copy", fixture: messages)
        .environment(HostStore())
        .environment(viewer)
      let window = NSWindow(
        contentRect: NSRect(x: -6000, y: -6000, width: 900, height: 900), styleMask: [.borderless],
        backing: .buffered, defer: false)
      window.contentView = NSHostingView(rootView: root)
      window.orderFrontRegardless()
      for _ in 0..<20 {
        pass(window)
        try await Task.sleep(for: .milliseconds(20))
      }
      let view = try #require(
        textViews(in: window.contentView).first { $0.string.contains("ABC-123") && $0.visibleRect.height > 0 })
      return (window, view)
    }

    /// Window points at the middle of a string's first and last characters.
    private static func ends(of needle: String, in view: NSTextView) throws -> (NSPoint, NSPoint) {
      let range = (view.string as NSString).range(of: needle)
      let first = try #require(rect(view, range.location))
      let last = try #require(rect(view, NSMaxRange(range) - 1))
      return (
        view.convert(NSPoint(x: first.minX + 1, y: first.midY), to: nil),
        view.convert(NSPoint(x: last.maxX - 1, y: last.midY), to: nil)
      )
    }

    /// A press, drag and release; the tracking loop takes the queued drags and release.
    private static func press(_ window: NSWindow, at start: NSPoint, dragTo end: NSPoint, clicks: Int) {
      for step in 1...8 where start != end {
        let t = CGFloat(step) / 8
        let at = NSPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)
        NSApp.postEvent(mouse(.leftMouseDragged, at: at, in: window, clicks: clicks), atStart: false)
      }
      NSApp.postEvent(mouse(.leftMouseUp, at: end, in: window, clicks: clicks), atStart: false)
      window.sendEvent(mouse(.leftMouseDown, at: start, in: window, clicks: clicks))
      pass(window)
    }

    private static func copy(_ view: TranscriptNSTextView) -> String? {
      setenv("ARGUS_TEST_PASTEBOARD", "argus-transcript-copy-tests", 1)
      defer { unsetenv("ARGUS_TEST_PASTEBOARD") }
      let board = TranscriptSystem.pasteboard
      board.clearContents()
      view.copy(nil)
      return board.string(forType: .string)
    }

    private static func highlighted(_ window: NSWindow) -> [String] {
      textViews(in: window.contentView).compactMap { view in
        let range = view.selectedRange()
        return range.length > 0 ? (view.string as NSString).substring(with: range) : nil
      }
    }

    private static func mouse(_ type: NSEvent.EventType, at point: NSPoint, in window: NSWindow, clicks: Int) -> NSEvent {
      NSEvent.mouseEvent(
        with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: clicks,
        pressure: type == .leftMouseUp ? 0 : 1)!
    }

    private static func rect(_ view: NSTextView, _ index: Int) -> NSRect? {
      guard let layout = view.textLayoutManager, let manager = layout.textContentManager,
        let start = manager.location(manager.documentRange.location, offsetBy: index),
        let end = manager.location(start, offsetBy: 1), let range = NSTextRange(location: start, end: end)
      else { return nil }
      var found: NSRect?
      layout.enumerateTextSegments(in: range, type: .standard, options: []) { _, frame, _, _ in
        found = frame
        return false
      }
      return found.map { $0.offsetBy(dx: view.textContainerOrigin.x, dy: view.textContainerOrigin.y) }
    }

    private static func textViews(in view: NSView?) -> [TranscriptNSTextView] {
      guard let view else { return [] }
      return (view as? TranscriptNSTextView).map { [$0] } ?? view.subviews.flatMap { textViews(in: $0) }
    }

    private static func pass(_ window: NSWindow) {
      window.contentView?.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
      RunLoop.main.run(until: Date())
      window.contentView?.layoutSubtreeIfNeeded()
      window.displayIfNeeded()
    }
  }
}
