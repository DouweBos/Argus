import AppKit
import ArgusCore
import ArgusEditor
import Foundation
import Testing

@testable import Argus

@Suite("Quick open")
struct QuickOpenModelTests {
  @Test("its keys don't collide with the editor's or each other")
  func shortcuts() {
    let quickOpen = QuickOpenModel.Entry.allCases.map(\.shortcut)
    let editor = EditorCommand.allCases.map(\.shortcut) + [CodeShortcuts.wordWrap, CodeShortcuts.format]
    #expect(Set(quickOpen).count == quickOpen.count)
    #expect(Set(quickOpen).isDisjoint(with: editor))
  }

  @Test("telemetry names the mode by what was asked, never the text")
  func telemetryMode() {
    typealias Mode = MacTelemetryEvent.EditorQuickOpenMode
    #expect(Mode(.parse("store", base: .files)) == .files)
    #expect(Mode(.parse("store", base: .mixed)) == .mixed)
    #expect(Mode(.parse("#store", base: .files)) == .symbols)
    #expect(Mode(.parse("@load", base: .mixed)) == .fileSymbols)
    #expect(Mode(.parse(":12", base: .files)) == .line)
  }

  @Test("arrow keys wrap around the ends; paging and Home/End stop at them")
  func selectionMoves() {
    let moved = QuickOpenModel.moved
    #expect(moved(0, .next, 3) == 1)
    #expect(moved(2, .next, 3) == 0)
    #expect(moved(0, .previous, 3) == 2)
    #expect(moved(1, .previous, 3) == 0)
    #expect(moved(2, .pageDown, 20) == 2 + QuickOpenModel.pageSize)
    #expect(moved(18, .pageDown, 20) == 19)
    #expect(moved(3, .pageUp, 20) == 0)
    #expect(moved(5, .first, 20) == 0)
    #expect(moved(5, .last, 20) == 19)
    #expect(moved(7, .next, 0) == 0, "no rows, nothing selected")
    #expect(moved(9, .next, 3) == 0, "a stale index left over from more rows is clamped first")
  }

  @Test("the field turns ↑/↓, ⌃P/⌃N, paging and Home/End into list moves, not caret moves")
  func fieldKeys() {
    let move = QuickOpenField.Coordinator.move(for:)
    #expect(move(#selector(NSResponder.moveDown(_:))) == .next)
    #expect(move(#selector(NSResponder.moveUp(_:))) == .previous)
    #expect(move(#selector(NSResponder.scrollPageDown(_:))) == .pageDown)
    #expect(move(#selector(NSResponder.pageUp(_:))) == .pageUp)
    #expect(move(#selector(NSResponder.scrollToBeginningOfDocument(_:))) == .first)
    #expect(move(#selector(NSResponder.scrollToEndOfDocument(_:))) == .last)
    #expect(move(#selector(NSResponder.moveLeft(_:))) == nil, "←/→ still edit the query")
  }
}
