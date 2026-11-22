import AppKit
import ArgusCore
import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI
import Testing

@testable import Argus

extension WindowDrivingTests {
  /// What Argus adds to GroveUIKit's diff, and that it reaches the table.
  @MainActor
  @Suite(.serialized)
  struct DiffIntegrationTests {
    private static let patch = """
      diff --git a/src/merge.ts b/src/merge.ts
      --- a/src/merge.ts
      +++ b/src/merge.ts
      @@ -1,3 +1,4 @@
       const git = gitAt(root)
      -const base = await git.mergeBase(root)
      +const strategy = await settings.mergeStrategy(root)
      +log.info("merging")
       return git.merge(branch)

      """

    private func comment(line: Int, side: DiffReviewComment.Side, text: String) -> DiffReviewComment {
      DiffReviewComment(
        path: "src/merge.ts", side: side, lines: line...line, excerpt: [text], hunk: "", scope: "uncommitted changes",
        body: "Why?")
    }

    private func context(_ comments: [DiffReviewComment]) -> DiffReviewContext {
      DiffReviewContext(scope: "uncommitted changes", comments: comments, add: { _ in }, update: { _, _ in }, delete: { _ in })
    }

    private func diffTable(in view: NSView) -> GitDiffTableView? {
      (view as? GitDiffTableView) ?? view.subviews.lazy.compactMap(diffTable).first
    }

    private func show(_ root: some View) -> (NSWindow, NSHostingView<AnyView>) {
      let hosting = NSHostingView(rootView: AnyView(root))
      let window = NSWindow(
        contentRect: NSRect(x: -6000, y: -6000, width: 900, height: 600), styleMask: [.borderless], backing: .buffered,
        defer: false)
      window.isReleasedWhenClosed = false
      window.contentView = hosting
      window.orderFrontRegardless()
      settle(window, hosting)
      return (window, hosting)
    }

    private func settle(_ window: NSWindow, _ hosting: NSView) {
      for _ in 0..<3 {
        hosting.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.02))
      }
    }

    @Test func commentsHangUnderTheirLineOnTheirSide() throws {
      let diff = try #require(GroveKit.DiffParser.parse(Self.patch).first)
      let old = comment(line: 2, side: .old, text: "const base = await git.mergeBase(root)")
      let new = comment(line: 3, side: .new, text: "log.info(\"merging\")")
      #expect(DiffReviewAnchors.anchor(old, in: diff) == GitDiffLineAnchor(hunk: 0, line: 1))
      #expect(DiffReviewAnchors.anchor(new, in: diff) == GitDiffLineAnchor(hunk: 0, line: 3))
      #expect(DiffReviewAnchors.anchor(comment(line: 2, side: .old, text: "gone"), in: diff) == nil)
    }

    @Test func commentsShowAsRowsTheDriverCanFind() throws {
      let diff = try #require(GroveKit.DiffParser.parse(Self.patch).first)
      let review = context([comment(line: 3, side: .new, text: "log.info(\"merging\")")])
      let (window, hosting) = show(
        GitDiffView(diff: diff, annotations: review.annotations(theme: .dark)).argusGitUI())
      defer { window.orderOut(nil) }
      let table = try #require(diffTable(in: hosting))
      // The header, five lines, and the comment under its line.
      #expect(table.numberOfRows == 7)
      #expect(table.rect(ofRow: 5).height > 40)
      table.selectRowIndexes([2, 3], byExtendingSelection: false)
      #expect(Array(table.selectedRowIndexes) == [2, 3])
    }

    @Test func aColourThemeAndZoomReachALiveDiff() throws {
      defer { TextScale.shared.factor = 1 }
      let diff = try #require(GroveKit.DiffParser.parse(Self.patch).first)
      let pane = DiffPane(diff: diff, path: diff.filePath)
      // Another suite can have left the app at another display size.
      TextScale.shared.factor = 1
      let (window, hosting) = show(pane.environment(\.theme, Theme.dark))
      defer { window.orderOut(nil) }
      let table = try #require(diffTable(in: hosting))
      #expect(table.rect(ofRow: 1).height == 17)

      TextScale.shared.factor = 17 / 13
      settle(window, hosting)
      #expect(table.rect(ofRow: 1).height == 22)
      hosting.rootView = AnyView(pane.environment(\.theme, Theme.resolved(for: .dark, colorTheme: .ocean)))
      settle(window, hosting)
      #expect(diffTable(in: hosting) === table, "restyled, not rebuilt")
    }

    /// Posts a real click-and-drag, which the table's tracking loop needs a running app for.
    @Test func draggingAlongALineCopiesItsText() throws {
      let diff = try #require(GroveKit.DiffParser.parse(Self.patch).first)
      var copied: [String] = []
      let (window, hosting) = show(
        GitDiffView(diff: diff).gitUIHost(GitUIHost(copy: { copied.append($0) }))
          // Its own scale: the points below are the unscaled ones.
          .gitUIStyle(.argus(.dark, scale: 1)))
      defer { window.orderOut(nil) }
      let table = try #require(diffTable(in: hosting))
      let cell = ("0" as NSString).size(withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)]).width
      // Two 44pt gutters and the sign.
      let textX: CGFloat = 104
      let y = table.rect(ofRow: 1).midY
      func event(_ type: NSEvent.EventType, column: CGFloat) throws -> NSEvent {
        try #require(
          NSEvent.mouseEvent(
            with: type, location: table.convert(NSPoint(x: textX + column * cell + 1, y: y), to: nil), modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0,
            clickCount: 1, pressure: 1))
      }
      // Far past the line's end: an event posted to an offscreen window lands a few points off.
      NSApp.postEvent(try event(.leftMouseDragged, column: 70), atStart: false)
      NSApp.postEvent(try event(.leftMouseUp, column: 70), atStart: false)
      table.mouseDown(with: try event(.leftMouseDown, column: 6))
      NSApp.sendAction(#selector(NSText.copy(_:)), to: table, from: nil)
      #expect(copied == ["git = gitAt(root)"])
      #expect(table.selectedRowIndexes.isEmpty, "text, not the line")
    }

    /// Wheel events need a running app too.
    @Test func wheelingUpThroughWrappedLinesDoesNotJump() throws {
      let lines = (0..<60_000).map { index in
        let words = (index * 7919) % 13 == 0 ? 120 : (index * 31) % 5 == 0 ? 30 : 0
        return GroveKit.DiffLine(
          id: "\(index)", type: .context, content: "line \(index) " + String(repeating: "word ", count: words),
          oldLineNumber: index + 1, newLineNumber: index + 1)
      }
      let hunk = HunkData(id: "h", header: "@@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: lines)
      let diff = DiffResult(filePath: "long.txt", hunks: [hunk], stats: DiffStats(additions: 0, deletions: 0))
      let (window, hosting) = show(GitDiffView(diff: diff, options: GitDiffOptions(wrapsLines: .constant(true))).argusGitUI())
      defer { window.orderOut(nil) }
      let table = try #require(diffTable(in: hosting))
      let scroll = try #require(table.enclosingScrollView)
      scroll.contentView.scroll(to: NSPoint(x: 0, y: table.frame.height / 2))
      settle(window, hosting)
      var worst: CGFloat = 0
      for _ in 0..<100 {
        let from = scroll.contentView.bounds.minY
        let row = table.row(at: NSPoint(x: 1, y: from + 1))
        let onScreen = table.rect(ofRow: row).minY - from
        let wheel = try #require(
          CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: 120, wheel2: 0, wheel3: 0))
        wheel.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        scroll.scrollWheel(with: try #require(NSEvent(cgEvent: wheel)))
        hosting.layoutSubtreeIfNeeded()
        window.displayIfNeeded()
        RunLoop.main.run(until: Date())
        worst = max(worst, abs(table.rect(ofRow: row).minY - scroll.contentView.bounds.minY - onScreen - 120))
      }
      #expect(worst < 2, "the line on screen moved \(worst)pt more than the scroll")
    }

    @Test func theStyleFollowsTheColourTheme() {
      let ocean = Theme.resolved(for: .dark, colorTheme: .ocean)
      let style = GitUIStyle.argus(ocean, scale: 1.2)
      #expect(style.accent == ocean.accent && style.info == ocean.accent)
      #expect(style.syntax.keyword == ocean.syntaxKeyword)
      #expect(style.fontScale == 1.2 && style.showsPointingHand)
    }
  }
}
