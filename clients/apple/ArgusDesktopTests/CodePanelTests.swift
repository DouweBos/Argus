import ArgusCore
import Foundation
import Testing

@testable import Argus

struct CodeRouteTests {
  @Test(arguments: [
    ("/sessions/s1/code", DesktopRoute.sessionCode(id: "s1", path: nil, line: nil)),
    ("/sessions/s1/code?path=Sources/App.swift", .sessionCode(id: "s1", path: "Sources/App.swift", line: nil)),
    ("/sessions/s1/code?path=a%20b/c.ts&line=42", .sessionCode(id: "s1", path: "a b/c.ts", line: 42)),
    ("/sessions/s1/code?line=3", .sessionCode(id: "s1", path: nil, line: nil)),
  ])
  func parses(path: String, route: DesktopRoute) {
    #expect(DesktopRoute(path: path) == route)
  }

  @Test(arguments: [
    DesktopRoute.sessionCode(id: "s1", path: nil, line: nil),
    .sessionCode(id: "s1", path: "src/a b&c=d.swift", line: 7),
    .sessionCode(id: "s1", path: "README.md", line: nil),
  ])
  func roundTrips(route: DesktopRoute) {
    #expect(DesktopRoute(path: route.path) == route)
    #expect(route.sessionId == "s1")
    #expect(route.pattern == "/sessions/:sessionId/code")
  }

  @Test func deepLink() {
    let url = URL(string: "argus://sessions/s1/code?path=a.swift&line=9")!
    #expect(DesktopRoute(deepLink: url) == .sessionCode(id: "s1", path: "a.swift", line: 9))
  }
}

struct CodeTabListTests {
  @Test func previewIsReused() {
    var tabs = CodeTabList()
    tabs.open("a", preview: true)
    let closed = tabs.open("b", preview: true)
    #expect(closed == ["a"])
    #expect(tabs.tabs == [.init(path: "b", isPreview: true)])
  }

  @Test func pinnedTabsStay() {
    var tabs = CodeTabList()
    tabs.open("a", preview: true)
    tabs.pin("a")
    tabs.open("b", preview: true)
    #expect(tabs.paths == ["a", "b"])
    #expect(tabs.previewPath == "b")
  }

  @Test func dirtyPreviewIsNotReplaced() {
    var tabs = CodeTabList()
    tabs.open("a", preview: true)
    let closed = tabs.open("b", preview: true) { $0 == "a" }
    #expect(closed.isEmpty)
    #expect(tabs.paths == ["a", "b"])
  }

  @Test func reopeningPinsOnlyWhenAsked() {
    var tabs = CodeTabList()
    tabs.open("a", preview: true)
    tabs.open("a", preview: true)
    #expect(tabs.previewPath == "a")
    tabs.open("a", preview: false)
    #expect(tabs.previewPath == nil)
  }

  @Test func capClosesOldestCleanTab() {
    var tabs = CodeTabList()
    for index in 0..<CodeTabList.cap { tabs.open("f\(index)", preview: false) }
    let closed = tabs.open("new", preview: false) { $0 == "f0" }
    #expect(closed == ["f1"])
    #expect(tabs.tabs.count == CodeTabList.cap)
    #expect(tabs.contains("f0"))
    #expect(tabs.contains("new"))
  }

  @Test func closingActivePicksNeighbour() {
    var tabs = CodeTabList()
    for path in ["a", "b", "c"] { tabs.open(path, preview: false) }
    #expect(tabs.close("b", active: "b") == "a")
    #expect(tabs.close("a", active: "a") == "c")
    #expect(tabs.close("missing", active: "c") == "c")
    #expect(tabs.close("c", active: "c") == nil)
  }
}

struct CodeDiskStateTests {
  @Test func cleanBufferReloads() {
    var state = CodeDiskState(baseHash: "h1")
    #expect(state.diskChanged(hash: "h2", isDirty: false) == .reload)
    #expect(state.diskChanged(hash: "h1", isDirty: true) == .none)
  }

  @Test func dirtyBufferAsksAndKeepMineForces() {
    var state = CodeDiskState(baseHash: "h1")
    #expect(state.diskChanged(hash: "h2", isDirty: true) == .showBanner)
    #expect(state.banner == .changedOnDisk)
    state.keepMine()
    #expect(state.banner == nil)
    #expect(state.saveRequest.force)
    #expect(state.hadConflict)
    state.saved(hash: "h3")
    #expect(!state.saveRequest.force)
    #expect(state.saveRequest.baseHash == "h3")
    #expect(!state.hadConflict)
  }

  @Test func anotherChangeAfterKeepMineAsksAgain() {
    var state = CodeDiskState(baseHash: "h1")
    _ = state.diskChanged(hash: "h2", isDirty: true)
    state.keepMine()
    #expect(state.diskChanged(hash: "h3", isDirty: true) == .showBanner)
    #expect(!state.saveRequest.force)
  }

  @Test func saveConflictRaisesTheBanner() {
    var state = CodeDiskState(baseHash: "h1")
    state.saveConflicted(diskHash: "h2")
    #expect(state.banner == .saveConflict)
    #expect(state.saveRequest.baseHash == "h1")
  }

  @Test func deletedFileSavesWithoutBase() {
    var state = CodeDiskState(baseHash: "h1")
    #expect(state.diskChanged(hash: nil, isDirty: false) == .markDeleted)
    #expect(state.isDeleted)
    #expect(state.saveRequest.baseHash == nil)
    #expect(state.diskChanged(hash: nil, isDirty: false) == .none)
    state.saved(hash: "h2")
    #expect(!state.isDeleted)
  }
}

struct CodeEditorSettingsTests {
  @Test func appSettingsApplyWithoutEditorConfig() {
    let settings = CodeEditorSettings(fontName: "Menlo", fontSize: 14, tabWidth: 2, insertSpaces: false, wrapLines: true)
    let configuration = settings.configuration(applying: .init())
    #expect(configuration.fontName == "Menlo")
    #expect(configuration.fontSize == 14)
    #expect(configuration.tabWidth == 2)
    #expect(!configuration.insertSpaces)
    #expect(configuration.wrapLines)
    #expect(!configuration.trimTrailingWhitespaceOnSave)
  }

  @Test func editorConfigWins() {
    let properties = EditorConfig.Properties(
      indentStyle: .space, indentSize: 2, tabWidth: 8, insertFinalNewline: true, trimTrailingWhitespace: true)
    let configuration = CodeEditorSettings(tabWidth: 4, insertSpaces: false).configuration(applying: properties)
    #expect(configuration.insertSpaces)
    #expect(configuration.tabWidth == 2)
    #expect(configuration.insertFinalNewline)
    #expect(configuration.trimTrailingWhitespaceOnSave)
  }

  @Test func tabsUseTabWidth() {
    let properties = EditorConfig.Properties(indentStyle: .tab, indentSize: 2, tabWidth: 8)
    #expect(CodeEditorSettings().configuration(applying: properties).tabWidth == 8)
  }

  @Test func resolvesThroughTheCache() async {
    let files = ["": "root = true\n[*]\nindent_size = 4\n", "src": "[*.swift]\nindent_size = 2\n"]
    let cache = await EditorConfigCache { path in files[(path as NSString).deletingLastPathComponent] }
    #expect(await cache.properties(for: "src/a.swift").indentSize == 2)
    #expect(await cache.properties(for: "README.md").indentSize == 4)
    #expect(EditorConfigCache.directories(above: "a/b/c.txt") == ["a/b", "a", ""])
  }
}

struct CodeHunksTests {
  @Test func marksAndRevert() {
    let hunks = CodeHunks(base: "a\nb\nc\nd\n", current: "a\nB\nc\nd\ne\n")
    #expect(hunks.marks.map(\.kind) == [.modified, .added])
    let reverted = hunks.reverting(hunks.hunks[0])
    #expect(reverted == "a\nb\nc\nd\ne\n")
  }

  @Test func patchHasContext() {
    let hunks = CodeHunks(base: "1\n2\n3\n4\n5\n6\n7\n", current: "1\n2\n3\nX\n5\n6\n7\n")
    let patch = hunks.patch(for: hunks.hunks[0], path: "f.txt")
    #expect(patch?.contains("@@ -1,7 +1,7 @@") == true)
    #expect(patch?.contains("-4\n+X\n") == true)
  }

  @Test func noPatchAtAMissingFinalNewline() {
    let hunks = CodeHunks(base: "a\nb", current: "a\nc")
    #expect(hunks.patch(for: hunks.hunks[0], path: "f") == nil)
  }

  @Test func minimalEdit() {
    let edit = CodeHunks.edit(from: "hello world", to: "hello there world")
    #expect(edit.range == NSRange(location: 6, length: 0))
    #expect(edit.text == "there ")
  }

  @MainActor @Test func diffResultCountsLines() {
    let result = CodeHunks(base: "a\nb\n", current: "a\nc\nd\n").diffResult(path: "f")
    #expect(result.stats.additions == 2)
    #expect(result.stats.deletions == 1)
  }
}
