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
}
