import ArgusCore
import ArgusEditor
import Foundation
import SwiftUI
import Testing

@testable import Argus

@MainActor
@Suite("Keyboard shortcuts")
struct KeyboardShortcutsTests {
  @Test("every command has its own id and the defaults clash nowhere")
  func catalog() {
    let ids = ShortcutCommand.all.map(\.id)
    #expect(Set(ids).count == ids.count)
    #expect(ShortcutKeymap.argusDefaults.conflictingIds.isEmpty)
  }

  @Test("the catalog keeps the keys the menus always had")
  func defaults() {
    let keymap = ShortcutKeymap.argusDefaults
    #expect(keymap.chord(for: .commandPalette)?.display == "⇧⌘P")
    #expect(keymap.chord(for: .nextAgent)?.display == "⇧⌘]")
    #expect(keymap.chord(for: .agents[8])?.display == "⌃⌘9")
    #expect(keymap.chord(for: .git(.commit))?.display == "⌘↩")
    #expect(keymap.chord(for: .editor(.goToDefinition))?.display == "F12")
    #expect(keymap.chord(for: .editor(.foldAll)) == nil)
    #expect(ShortcutCommand.editor(.foldAll).sequence.map(\.display) == ["⌘K", "⌘0"])
  }

  @Test("a rebind and a removed key survive a relaunch; Reset All forgets them")
  func persistence() throws {
    let defaults = try #require(UserDefaults(suiteName: "argus-tests-\(UUID().uuidString)"))
    let prefs = AppPreferences(defaults: defaults)
    prefs.rebind(.git(.push), to: KeyChord("k", [.control, .command]))
    prefs.rebind(.inbox, to: nil)
    let relaunched = AppPreferences(defaults: defaults)
    #expect(relaunched.shortcutKeymap.chord(for: .git(.push)) == KeyChord("k", [.control, .command]))
    #expect(relaunched.shortcutKeymap.chord(for: .inbox) == nil)
    #expect(relaunched.shortcutKeymap.chord(for: .newSession) == KeyChord("n", .command))
    relaunched.resetAllShortcuts()
    #expect(AppPreferences(defaults: defaults).shortcutKeymap == .argusDefaults)
  }

  @Test("a rebind onto another command's key is a conflict, and resetting one clears it")
  func conflict() throws {
    let defaults = try #require(UserDefaults(suiteName: "argus-tests-\(UUID().uuidString)"))
    let prefs = AppPreferences(defaults: defaults)
    prefs.rebind(.inbox, to: KeyChord("n", .command))
    #expect(prefs.shortcutKeymap.conflicts(for: ShortcutCommand.inbox.id) == [ShortcutCommand.newSession.id])
    prefs.resetShortcut(.inbox)
    #expect(prefs.shortcutKeymap.conflictingIds.isEmpty)
  }

  @Test("menus get a shifted symbol as its character, everything else as pressed")
  func menuKeys() {
    let next = KeyChord("]", [.shift, .command]).keyboardShortcut
    #expect(next.key.character == "}")
    #expect(next.modifiers == .command)
    let push = KeyChord("u", [.shift, .command]).keyboardShortcut
    #expect(push.key.character == "u")
    #expect(push.modifiers == [.shift, .command])
    #expect(KeyChord(KeyChord.Key.return, .command).keyboardShortcut.key == .return)
  }

  @Test("editor keys read the same as the editor's own table")
  func editorKeys() {
    for command in EditorCommand.allCases {
      #expect(KeyChord(command.defaultShortcut).editorShortcut == command.defaultShortcut)
    }
  }

  @Test("search narrows by title, area or key")
  func search() {
    let keymap = ShortcutKeymap.argusDefaults
    #expect(KeyboardSettingsTab.groups(matching: "", in: keymap).count == ShortcutArea.allCases.count)
    let push = KeyboardSettingsTab.groups(matching: "push", in: keymap)
    #expect(push.map(\.area) == [.git])
    #expect(KeyboardSettingsTab.groups(matching: "⇧⌘u", in: keymap).flatMap(\.commands) == [.git(.push)])
    #expect(KeyboardSettingsTab.groups(matching: "zzz", in: keymap).isEmpty)
  }
}
