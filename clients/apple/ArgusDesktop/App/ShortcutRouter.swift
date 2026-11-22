import AppKit
import SwiftUI

/// A key and its modifiers, as pressed.
struct ShortcutChord: Equatable {
  let key: Character
  let modifiers: EventModifiers

  init(_ key: Character, _ modifiers: EventModifiers) {
    self.key = key
    self.modifiers = modifiers
  }

  static let fetch = Self("f", [.command, .shift])
  static let pull = Self("p", [.command, .shift])
  static let push = Self("u", [.command, .shift])
  static let branch = Self("b", .command)
  static let merge = Self("m", [.command, .shift])
  static let rebase = Self("r", [.command, .shift])
  static let commit = Self("\r", .command)
  static let stash = Self("s", [.command, .shift])
  static let snapshot = Self("s", [.command, .option])
  static let undo = Self("z", [.command, .option])

  var keyboardShortcut: KeyboardShortcut {
    KeyboardShortcut(key == "\r" ? .return : KeyEquivalent(key), modifiers: modifiers)
  }

  init?(event: NSEvent) {
    guard event.type == .keyDown else { return nil }
    let flags = event.modifierFlags
    guard flags.contains(.command), !flags.contains(.control) else { return nil }
    var modifiers: EventModifiers = .command
    if flags.contains(.shift) { modifiers.insert(.shift) }
    if flags.contains(.option) { modifiers.insert(.option) }
    if event.keyCode == 36 || event.keyCode == 76 {
      self.init("\r", modifiers)
      return
    }
    var typed = event.charactersIgnoringModifiers?.lowercased()
    // A non-Latin layout types Latin with ⌘ held, which is what menus match.
    if typed?.first?.isASCII != true { typed = event.characters(byApplyingModifiers: .command)?.lowercased() }
    guard let key = typed?.first else { return nil }
    self.init(key, modifiers)
  }
}

/// Where a key was pressed, as far as the router cares.
struct ShortcutContext: Equatable {
  enum Focus {
    case none
    /// The commit's summary or description.
    case commitMessage
    /// An editor, terminal, composer, comment or any other text.
    case text
  }

  /// The main window is key, without a sheet, modal alert or marked text.
  var takesKeys = true
  var hasRepository = false
  var inCode = false
  var gitInFront = false
  /// The pull request view's comment box sends on ⌘↩ itself.
  var inPullRequests = false
  var diffTabFocused = false
  var paletteOpen = false
  var focus = Focus.none

  var ownsPanelKeys: Bool { hasRepository && (gitInFront || diffTabFocused) }
}

/// The keys several commands want, decided here rather than by menu items, which SwiftUI
/// strips of a duplicate key and updates late when the key moves between them.
enum ShortcutRouter {
  enum Resolution: Equatable {
    case git(GitMenuAction)
    case commandPalette, findInFiles, toggleNavigator, toggleProblems, saveAll
    /// Left to the responder chain and the menus.
    case pass
  }

  static func resolve(_ chord: ShortcutChord, _ context: ShortcutContext) -> Resolution {
    guard context.takesKeys else { return .pass }
    if context.paletteOpen { return chord == .pull ? .commandPalette : .pass }
    let inSession = context.hasRepository
    switch chord {
    case .push: return inSession ? .git(.push) : .pass
    case .rebase: return inSession ? .git(.rebase) : .pass
    case .stash: return inSession ? .git(.stash) : .pass
    case .fetch:
      if context.inCode { return .findInFiles }
      return inSession ? .git(.fetch) : .pass
    case .branch:
      if context.inCode { return .toggleNavigator }
      return inSession ? .git(.branch) : .pass
    case .merge:
      if context.inCode { return .toggleProblems }
      return inSession ? .git(.merge) : .pass
    case .pull:
      return context.ownsPanelKeys ? .git(.pull) : .commandPalette
    case .commit:
      guard context.ownsPanelKeys, context.focus != .text else { return .pass }
      return context.gitInFront && context.inPullRequests ? .pass : .git(.commit)
    case .snapshot:
      if context.ownsPanelKeys { return .git(.snapshot) }
      return context.inCode ? .saveAll : .pass
    case .undo:
      return context.ownsPanelKeys ? .git(.undo) : .pass
    default:
      return .pass
    }
  }

  @MainActor private static var monitor: Any?

  @MainActor static func install(_ model: DesktopModel) {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak model] event in
      nonisolated(unsafe) let event = event
      let handled = MainActor.assumeIsolated {
        guard let model, let chord = ShortcutChord(event: event),
          let window = event.window ?? NSApp.window(withWindowNumber: event.windowNumber)
        else { return false }
        let resolution = resolve(chord, model.shortcutContext(in: window))
        guard resolution != .pass else { return false }
        if !event.isARepeat { model.run(resolution) }
        return true
      }
      return handled ? nil : event
    }
  }
}
