import AppKit
import ArgusCore
import ArgusUI
import Foundation
import SwiftUI
import Testing

@testable import Argus

extension WindowDrivingTests {
  /// Hosted rows are as tall as they lay out, whenever their cell was built:
  /// a row cut short draws its content centred over its neighbours.
  @MainActor
  @Suite(.serialized)
  struct TranscriptRowHeightTests {
    private static let viewer = ImageViewerState()

    private static func message(_ id: String, _ role: String, _ text: String) -> RemoteMessage {
      let raw: [String: Any] = ["id": id, "role": role, "text_blocks": [text], "timestamp": 1_760_000_000_000.0, "tool_calls": []]
      let data = try! JSONSerialization.data(withJSONObject: [raw])
      return try! JSONDecoder().decode([RemoteMessage].self, from: data)[0]
    }

    private static let ask = """
      Can you look at why the sent bubble clips its first and last lines when its row was measured earlier?
      It happens right after sending, with the working indicator just below it.
      A third line that is long enough to wrap at least once in the bubble's narrower column.
      """

    private static let chat: [RemoteMessage] = (0..<30).flatMap { turn in
      [
        message("u\(turn)", "user", "\(turn). \(ask)"),
        message("a\(turn)", "assistant", String(repeating: "An answer that runs on for a while. ", count: 12)),
      ]
    }

    /// Cells built ahead of the reader at one width, then read at another.
    @Test func preparedRowsFitAfterAResize() async throws {
      let store = HostStore()
      let hosting = NSHostingView(
        rootView: AnyView(
          TranscriptView(agentKey: "rowheight", sessionId: "rowheight", fixture: Self.chat)
            .environment(store).environment(Self.viewer)))
      let window = NSWindow(
        contentRect: NSRect(x: -6000, y: -6000, width: 1000, height: 600), styleMask: [.borderless],
        backing: .buffered, defer: false)
      window.contentView = hosting
      window.orderFrontRegardless()
      defer {
        window.orderOut(nil)
        window.contentView = nil
      }
      // Lands at the tail; prefetch builds the rows above at this width.
      try await settle(window, passes: 40)

      window.setContentSize(NSSize(width: 640, height: 600))
      try await settle(window, passes: 40)

      let scrollView = try #require(Self.views(TranscriptScrollView.self, in: hosting).first)
      let table = try #require(scrollView.documentView as? NSTableView)
      var clipped: [String] = []
      // Back up through the history, as a reader would.
      while clipped.isEmpty, scrollView.contentView.bounds.minY > 0.5 {
        let clip = scrollView.contentView
        clip.scroll(to: NSPoint(x: 0, y: max(0, clip.bounds.minY - 150)))
        scrollView.reflectScrolledClipView(clip)
        try await settle(window, passes: 2)
        clipped = Self.clipped(table)
      }
      #expect(clipped.isEmpty, "\(clipped)")
    }

    /// Hosted rows on screen whose text runs outside them.
    private static func clipped(_ table: NSTableView) -> [String] {
      let visible = table.rows(in: table.visibleRect)
      return (visible.location..<(visible.location + visible.length)).compactMap { index in
        guard let cell = table.view(atColumn: 0, row: index, makeIfNecessary: false) as? TranscriptCell else { return nil }
        let height = table.rect(ofRow: index).height
        for text in views(TranscriptMessageTextView.self, in: cell) {
          let frame = text.convert(text.bounds, to: cell)
          if frame.minY < -0.5 || frame.maxY > height + 0.5 { return "\(cell.rowId): text \(frame) in a row \(height) tall" }
        }
        return nil
      }
    }

    private static func views<T: NSView>(_ type: T.Type, in view: NSView) -> [T] {
      ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
    }

    private func settle(_ window: NSWindow, passes: Int) async throws {
      for _ in 0..<passes {
        window.contentView?.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
    }
  }
}
