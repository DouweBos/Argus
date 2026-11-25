import AppKit
import ArgusCore
import Testing

@testable import Argus

extension KeyChord {
  static let fetch = Self("f", [.command, .shift])
  static let pull = Self("p", [.command, .shift])
  static let push = Self("u", [.command, .shift])
  static let branch = Self("b", .command)
  static let merge = Self("m", [.command, .shift])
  static let rebase = Self("r", [.command, .shift])
  static let commit = Self(Key.return, .command)
  static let stash = Self("s", [.command, .shift])
  static let snapshot = Self("s", [.command, .option])
  static let undo = Self("z", [.command, .option])
}

struct ShortcutRouterTests {
  typealias Chord = KeyChord
  typealias Resolution = ShortcutRouter.Resolution

  static let outside = ShortcutContext()
  static let agents = ShortcutContext(hasRepository: true)
  static let code = ShortcutContext(hasRepository: true, inCode: true)
  static let git = ShortcutContext(hasRepository: true, gitInFront: true)
  static let diffTab = ShortcutContext(hasRepository: true, diffTabFocused: true)
  static let diffTabInCode = ShortcutContext(hasRepository: true, inCode: true, diffTabFocused: true)

  struct Row: CustomTestStringConvertible {
    let name: String
    let chord: Chord
    /// Outside a session, then agents, code, git, the Diff tab and the Diff tab beside code.
    let expected: [Resolution]
    var testDescription: String { name }
  }

  static let table: [Row] = [
    Row(name: "⇧⌘U", chord: .push, expected: [.pass, .git(.push), .git(.push), .git(.push), .git(.push), .git(.push)]),
    Row(
      name: "⇧⌘R", chord: .rebase,
      expected: [.pass, .git(.rebase), .git(.rebase), .git(.rebase), .git(.rebase), .git(.rebase)]),
    Row(
      name: "⇧⌘S", chord: .stash,
      expected: [.pass, .git(.stash), .git(.stash), .git(.stash), .git(.stash), .git(.stash)]),
    Row(
      name: "⇧⌘F", chord: .fetch,
      expected: [.pass, .git(.fetch), .findInFiles, .git(.fetch), .git(.fetch), .findInFiles]),
    Row(
      name: "⌘B", chord: .branch,
      expected: [.pass, .git(.branch), .toggleNavigator, .git(.branch), .git(.branch), .toggleNavigator]),
    Row(
      name: "⇧⌘M", chord: .merge,
      expected: [.pass, .git(.merge), .toggleProblems, .git(.merge), .git(.merge), .toggleProblems]),
    Row(
      name: "⇧⌘P", chord: .pull,
      expected: [.commandPalette, .commandPalette, .commandPalette, .git(.pull), .git(.pull), .git(.pull)]),
    Row(name: "⌘↩", chord: .commit, expected: [.pass, .pass, .pass, .git(.commit), .git(.commit), .git(.commit)]),
    Row(
      name: "⌥⌘S", chord: .snapshot,
      expected: [.pass, .pass, .saveAll, .git(.snapshot), .git(.snapshot), .git(.snapshot)]),
    Row(name: "⌥⌘Z", chord: .undo, expected: [.pass, .pass, .pass, .git(.undo), .git(.undo), .git(.undo)]),
  ]

  private static var contexts: [ShortcutContext] { [outside, agents, code, git, diffTab, diffTabInCode] }

  @Test(arguments: table)
  func eachChordInEachContext(_ row: Row) {
    #expect(Self.contexts.map { ShortcutRouter.resolve(row.chord, $0) } == row.expected)
  }

  @Test(arguments: table)
  func yieldsToSheetsOtherWindowsAndMarkedText(_ row: Row) {
    for var context in Self.contexts {
      context.takesKeys = false
      #expect(ShortcutRouter.resolve(row.chord, context) == .pass)
    }
  }

  @Test(arguments: table)
  func thePaletteOnlyKeepsItsOwnKey(_ row: Row) {
    for var context in Self.contexts {
      context.paletteOpen = true
      #expect(ShortcutRouter.resolve(row.chord, context) == (row.chord == .pull ? .commandPalette : .pass))
    }
  }

  @Test func commitYieldsToOtherText() {
    var context = Self.git
    context.focus = .text
    #expect(ShortcutRouter.resolve(.commit, context) == .pass)
    context.focus = .commitMessage
    #expect(ShortcutRouter.resolve(.commit, context) == .git(.commit))
    context.focus = .none
    context.inPullRequests = true
    #expect(ShortcutRouter.resolve(.commit, context) == .pass)
  }

  @Test func textFocusLeavesTheOtherKeysAlone() {
    for row in Self.table where row.chord != .commit {
      for context in Self.contexts {
        var typing = context
        typing.focus = .text
        #expect(ShortcutRouter.resolve(row.chord, typing) == ShortcutRouter.resolve(row.chord, context))
      }
    }
  }

  @Test func argusKeepsItsNavigationKeys() {
    let kept = [
      Chord("1", .command), Chord("2", .command), Chord("3", .command), Chord("a", [.command, .shift]),
      Chord("o", [.command, .shift]), Chord("[", .command), Chord("]", .command),
    ]
    for chord in kept {
      for context in Self.contexts { #expect(ShortcutRouter.resolve(chord, context) == .pass) }
    }
  }

  @Test func everyActionHasTheKeyItResolvesTo() {
    let keymap = ShortcutKeymap.argusDefaults
    for action in GitMenuAction.allCases where action != .createPullRequest {
      #expect(keymap.chord(for: .git(action)).map { ShortcutRouter.resolve($0, Self.git) } == .git(action))
    }
    #expect(keymap.chord(for: .git(.createPullRequest)) == nil)
  }

  @Test func followsARebind() {
    var keymap = ShortcutKeymap.argusDefaults
    keymap.bind(ShortcutCommand.git(.push).id, to: Chord("k", [.control, .command]))
    #expect(ShortcutRouter.resolve(.push, Self.agents, keymap) == .pass)
    #expect(ShortcutRouter.resolve(Chord("k", [.control, .command]), Self.agents, keymap) == .git(.push))
    keymap.bind(ShortcutCommand.commandPalette.id, to: Chord("k", [.shift, .command]))
    #expect(ShortcutRouter.resolve(.pull, Self.outside, keymap) == .pass)
    var open = Self.outside
    open.paletteOpen = true
    #expect(ShortcutRouter.resolve(Chord("k", [.shift, .command]), open, keymap) == .commandPalette)
  }

  @Test func theEditorKeepsItsKeysWhileFocused() {
    var editing = Self.code
    editing.editorFocused = true
    // ⌘L selects a line in the editor; the router leaves every editor key to it.
    #expect(ShortcutRouter.resolve(Chord("l", .command), editing, .argusDefaults) == .pass)
    #expect(ShortcutRouter.resolve(.branch, editing) == .toggleNavigator)
  }

  @Test func readsPressedKeys() {
    #expect(press("U", 32, [.command, .shift]) == .push)
    #expect(press("b", 11, [.command, .capsLock]) == .branch)
    #expect(press("\r", 36, .command) == .commit)
    #expect(press("\u{3}", 76, [.command, .numericPad]) == .commit)
    #expect(press("b", 11, []) == nil)
    #expect(press("b", 11, [.command, .control]) == Chord("b", [.control, .command]))
    #expect(press("}", 30, [.command, .shift]) == Chord("]", [.shift, .command]))
    #expect(press("\u{F70F}", 111, .function) == Chord(KeyChord.Key.function(12), []))
  }

  private func press(_ characters: String, _ code: UInt16, _ flags: NSEvent.ModifierFlags) -> Chord? {
    NSEvent.keyEvent(
      with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil,
      characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code
    ).flatMap(KeyChord.init(event:)).flatMap { $0.isUsable ? $0 : nil }
  }
}
