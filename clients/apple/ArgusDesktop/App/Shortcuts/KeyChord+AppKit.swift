import AppKit
import ArgusCore
import ArgusEditor
import SwiftUI

extension KeyChord {
  /// The key pressed, as its unshifted key: ⇧⌘] reads as "]" with ⇧, as `EditorShortcut` matches it.
  init?(event: NSEvent) {
    guard event.type == .keyDown else { return nil }
    let flags = event.modifierFlags
    var modifiers: Modifiers = []
    if flags.contains(.control) { modifiers.insert(.control) }
    if flags.contains(.option) { modifiers.insert(.option) }
    if flags.contains(.shift) { modifiers.insert(.shift) }
    if flags.contains(.command) { modifiers.insert(.command) }
    if let named = Self.namedKeys[event.keyCode] {
      self.init(named, modifiers)
      return
    }
    if let scalar = event.charactersIgnoringModifiers?.unicodeScalars.first, let named = Self.functionKeys[scalar.value] {
      self.init(named, modifiers)
      return
    }
    var typed = event.charactersIgnoringModifiers?.lowercased()
    if modifiers.contains(.shift) || modifiers.contains(.option),
      let base = event.characters(byApplyingModifiers: [])?.lowercased(), base.first?.isASCII == true
    {
      typed = base
    }
    // A non-Latin layout types Latin with ⌘ held, which is what menus match.
    if typed?.first?.isASCII != true { typed = event.characters(byApplyingModifiers: .command)?.lowercased() }
    guard let typed, typed.count == 1 else { return nil }
    self.init(typed, modifiers)
  }

  private static let namedKeys: [UInt16: String] = [
    36: Key.return, 76: Key.return, 48: Key.tab, 49: Key.space, 51: Key.delete, 117: Key.forwardDelete,
    53: Key.escape,
  ]

  /// AppKit's private-use characters for arrows, F-keys and the page keys.
  private static let functionKeys: [UInt32: String] = {
    var keys: [UInt32: String] = [
      0xF700: Key.up, 0xF701: Key.down, 0xF702: Key.left, 0xF703: Key.right, 0xF729: Key.home, 0xF72B: Key.end,
      0xF72C: Key.pageUp, 0xF72D: Key.pageDown, 0xF728: Key.forwardDelete,
    ]
    for number in 1...19 { keys[UInt32(NSF1FunctionKey + number - 1)] = Key.function(number) }
    return keys
  }()

  init(_ shortcut: EditorShortcut) {
    let character = shortcut.key.character
    let key = character.unicodeScalars.first.flatMap { Self.keyName(for: $0.value) } ?? String(character)
    self.init(key, Modifiers(shortcut.modifiers))
  }

  private static func keyName(for scalar: UInt32) -> String? {
    switch scalar {
    case 0x0D, 0x03: Key.return
    case 0x09: Key.tab
    case 0x20: Key.space
    case 0x08, 0x7F: Key.delete
    case 0x1B: Key.escape
    default: functionKeys[scalar]
    }
  }

  var keyEquivalent: KeyEquivalent {
    if let number = functionKeyNumber { return .function(number) }
    switch key {
    case Key.return: return .return
    case Key.tab: return .tab
    case Key.space: return .space
    case Key.delete: return .delete
    case Key.forwardDelete: return .deleteForward
    case Key.escape: return .escape
    case Key.up: return .upArrow
    case Key.down: return .downArrow
    case Key.left: return .leftArrow
    case Key.right: return .rightArrow
    case Key.home: return .home
    case Key.end: return .end
    case Key.pageUp: return .pageUp
    case Key.pageDown: return .pageDown
    default: return KeyEquivalent(Character(key))
    }
  }

  var eventModifiers: EventModifiers {
    var result: EventModifiers = []
    if modifiers.contains(.control) { result.insert(.control) }
    if modifiers.contains(.option) { result.insert(.option) }
    if modifiers.contains(.shift) { result.insert(.shift) }
    if modifiers.contains(.command) { result.insert(.command) }
    return result
  }

  /// For a menu item, which matches a shifted symbol by its character: ⇧⌘] only as "}" with ⌘.
  var keyboardShortcut: KeyboardShortcut {
    if modifiers.contains(.shift), let shifted = Self.shiftedSymbols[key] {
      return KeyboardShortcut(KeyEquivalent(shifted), modifiers: eventModifiers.subtracting(.shift))
    }
    return KeyboardShortcut(keyEquivalent, modifiers: eventModifiers)
  }

  var editorShortcut: EditorShortcut { EditorShortcut(keyEquivalent, eventModifiers) }

  /// A US keyboard's shifted symbols.
  private static let shiftedSymbols: [String: Character] = [
    "[": "{", "]": "}", "\\": "|", "/": "?", ";": ":", "'": "\"", ",": "<", ".": ">", "`": "~", "-": "_",
    "=": "+", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", "8": "*", "9": "(", "0": ")",
  ]
}

extension KeyChord.Modifiers {
  init(_ modifiers: EventModifiers) {
    self = []
    if modifiers.contains(.control) { insert(.control) }
    if modifiers.contains(.option) { insert(.option) }
    if modifiers.contains(.shift) { insert(.shift) }
    if modifiers.contains(.command) { insert(.command) }
  }
}
