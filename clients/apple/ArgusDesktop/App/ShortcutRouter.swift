import AppKit
import ArgusCore
import SwiftUI

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
  /// The code view's editor has focus, so its own keys come first.
  var editorFocused = false
  var paletteOpen = false
  var focus = Focus.none

  var ownsPanelKeys: Bool { hasRepository && (gitInFront || diffTabFocused) }

  /// The scopes whose commands are live here.
  var scopes: Set<ShortcutScope> {
    var scopes: Set<ShortcutScope> = [.global]
    if hasRepository { scopes.insert(.session) }
    if inCode { scopes.insert(.code) }
    if inCode && editorFocused { scopes.insert(.editor) }
    if ownsPanelKeys { scopes.insert(.gitPanel) }
    return scopes
  }
}

/// The keys several commands want, decided here rather than by menu items, which SwiftUI
/// strips of a duplicate key and updates late when the key moves between them. Which command
/// a key runs comes from the keymap: the narrowest live scope's.
enum ShortcutRouter {
  enum Resolution: Equatable {
    case git(GitMenuAction)
    case commandPalette, findInFiles, toggleNavigator, toggleProblems, saveAll
    /// Left to the responder chain and the menus.
    case pass
  }

  static func resolve(_ chord: KeyChord, _ context: ShortcutContext, _ keymap: ShortcutKeymap = .argusDefaults)
    -> Resolution
  {
    guard context.takesKeys else { return .pass }
    if context.paletteOpen {
      return chord == keymap.chord(for: ShortcutCommand.commandPalette) ? .commandPalette : .pass
    }
    guard let id = keymap.command(for: chord, in: context.scopes), let command = ShortcutCommand.named(id),
      let resolution = command.routed
    else { return .pass }
    if resolution == .git(.commit) {
      // The pull request view's comment box and other text send on ⌘↩ themselves.
      guard context.focus != .text, !(context.gitInFront && context.inPullRequests) else { return .pass }
    }
    return resolution
  }

  @MainActor private static var monitor: Any?

  @MainActor static func install(_ model: DesktopModel) {
    guard monitor == nil else { return }
    monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak model] event in
      nonisolated(unsafe) let event = event
      let handled = MainActor.assumeIsolated {
        guard let model, let chord = KeyChord(event: event), chord.isUsable,
          let window = event.window ?? NSApp.window(withWindowNumber: event.windowNumber)
        else { return false }
        let resolution = resolve(chord, model.shortcutContext(in: window), AppPreferences.shared.shortcutKeymap)
        guard resolution != .pass else { return false }
        if !event.isARepeat { model.run(resolution) }
        return true
      }
      return handled ? nil : event
    }
  }
}
