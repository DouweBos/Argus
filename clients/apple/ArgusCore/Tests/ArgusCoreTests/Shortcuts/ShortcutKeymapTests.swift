import Testing

@testable import ArgusCore

struct ShortcutKeymapTests {
  static let palette = ShortcutDefinition(id: "palette", scope: .global, defaultChord: KeyChord("p", [.shift, .command]))
  static let inbox = ShortcutDefinition(id: "inbox", scope: .global, defaultChord: KeyChord("i", [.shift, .command]))
  static let fetch = ShortcutDefinition(id: "fetch", scope: .session, defaultChord: KeyChord("f", [.shift, .command]))
  static let findInFiles = ShortcutDefinition(id: "find", scope: .code, defaultChord: KeyChord("f", [.shift, .command]))
  static let pull = ShortcutDefinition(id: "pull", scope: .gitPanel, defaultChord: KeyChord("p", [.shift, .command]))
  static let push = ShortcutDefinition(id: "push", scope: .session, defaultChord: KeyChord("u", [.shift, .command]))
  static let wrap = ShortcutDefinition(id: "wrap", scope: .code, defaultChord: nil)
  static let quit = ShortcutDefinition(id: "quit", scope: .global, defaultChord: KeyChord("q", .command), isFixed: true)

  static let definitions = [palette, inbox, fetch, findInFiles, pull, push, wrap, quit]
  var keymap = ShortcutKeymap(definitions: Self.definitions)

  @Test func defaultsThatLayerDoNotConflict() {
    #expect(keymap.conflictingIds.isEmpty)
    #expect(keymap.command(for: KeyChord("f", [.shift, .command]), in: [.global, .session]) == "fetch")
    #expect(keymap.command(for: KeyChord("f", [.shift, .command]), in: [.global, .session, .code]) == "find")
    #expect(keymap.command(for: KeyChord("p", [.shift, .command]), in: [.global, .session, .gitPanel]) == "pull")
    #expect(keymap.command(for: KeyChord("p", [.shift, .command]), in: [.global]) == "palette")
  }

  @Test mutating func sameKeyInOneScopeConflicts() {
    keymap.bind("inbox", to: KeyChord("p", [.shift, .command]))
    #expect(keymap.conflicts(for: "inbox") == ["palette", "pull"])
    #expect(keymap.conflicts(for: "palette") == ["inbox"])
    #expect(keymap.conflictingIds == ["inbox", "palette", "pull"])
  }

  @Test mutating func aRebindIntoANestedScopeConflicts() {
    keymap.bind("push", to: KeyChord("i", [.shift, .command]))
    #expect(keymap.conflicts(for: "push") == ["inbox"])
    #expect(keymap.conflicts(for: "inbox") == ["push"])
  }

  @Test mutating func scopesThatAreNeverLiveTogetherDoNotConflict() {
    keymap.bind("wrap", to: KeyChord("p", [.shift, .command]))
    // The code view and the git view are never in front at once.
    #expect(keymap.conflicts(for: "wrap") == ["palette"])
    #expect(!keymap.conflicts(for: "pull").contains("wrap"))
  }

  @Test mutating func rebindingAwayClearsTheConflict() {
    keymap.bind("inbox", to: KeyChord("p", [.shift, .command]))
    keymap.bind("inbox", to: KeyChord("y", [.control, .command]))
    #expect(keymap.conflictingIds.isEmpty)
  }

  @Test mutating func unboundCommandsNeverConflict() {
    keymap.bind("fetch", to: nil)
    keymap.bind("find", to: nil)
    #expect(keymap.chord(for: "fetch") == nil)
    #expect(keymap.conflicts(for: "fetch").isEmpty)
    #expect(keymap.command(for: KeyChord("f", [.shift, .command]), in: Set(ShortcutScope.allCases)) == nil)
  }

  @Test mutating func warnsOnlyAboutSystemKeysThePersonPicked() {
    keymap.bind("push", to: KeyChord("h", .command))
    #expect(keymap.systemShortcut(for: "push")?.name == "Hide Argus")
    #expect(keymap.systemShortcut(for: "quit") == nil)
  }

  @Test mutating func resetsOneOrAll() {
    keymap.bind("push", to: KeyChord("k", [.control, .command]))
    keymap.bind("fetch", to: nil)
    keymap.reset("push")
    #expect(keymap.chord(for: "push") == Self.push.defaultChord)
    #expect(keymap.isCustomized("fetch"))
    keymap.resetAll()
    #expect(!keymap.hasCustomizations)
    #expect(keymap.chord(for: "fetch") == Self.fetch.defaultChord)
  }

  @Test mutating func theDefaultAgainIsNoChange() {
    keymap.bind("push", to: KeyChord("k", [.control, .command]))
    keymap.bind("push", to: Self.push.defaultChord)
    #expect(!keymap.isCustomized("push"))
  }

  @Test mutating func fixedAndUnknownCommandsKeepTheirKeys() {
    keymap.bind("quit", to: KeyChord("k", .command))
    keymap.bind("nope", to: KeyChord("k", .command))
    #expect(keymap.chord(for: "quit") == KeyChord("q", .command))
    #expect(!keymap.hasCustomizations)
  }

  @Test mutating func storageRoundTrips() {
    keymap.bind("push", to: KeyChord(KeyChord.Key.return, [.control, .option, .shift, .command]))
    keymap.bind("fetch", to: nil)
    keymap.bind("wrap", to: KeyChord(KeyChord.Key.function(5), []))
    let storage = keymap.storage
    #expect(storage == ["push": "ctrl+opt+shift+cmd+return", "fetch": "", "wrap": "f5"])
    #expect(ShortcutKeymap(definitions: Self.definitions, storage: storage) == keymap)
  }

  @Test func storageDropsWhatItCannotRead() {
    let read = ShortcutKeymap(
      definitions: Self.definitions,
      storage: ["push": "cmd+", "fetch": "u", "inbox": "cmd+bogus", "gone": "cmd+k", "quit": "cmd+k", "wrap": "opt+z"])
    #expect(read.storage == ["wrap": "opt+z"])
  }

  @Test func chordsReadAndShow() {
    #expect(KeyChord("]", [.shift, .command]).display == "⇧⌘]")
    #expect(KeyChord(KeyChord.Key.function(12), .shift).displayParts == ["⇧", "F12"])
    #expect(KeyChord("P", .command) == KeyChord("p", .command))
    #expect(KeyChord(storageValue: "shift+cmd++") == KeyChord("+", [.shift, .command]))
    #expect(!KeyChord("a", .shift).isUsable)
    #expect(KeyChord("z", .option).isUsable)
    #expect(KeyChord(KeyChord.Key.function(2), []).isUsable)
  }
}
