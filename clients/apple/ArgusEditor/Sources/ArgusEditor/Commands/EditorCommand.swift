import AppKit
import SwiftUI

/// What the editor does on its own, with VS Code's macOS keys. The editor handles these keys
/// while its text view has focus; the app's menus list the same table.
public enum EditorCommand: String, CaseIterable, Sendable {
  case toggleLineComment, toggleBlockComment
  case moveLinesUp, moveLinesDown, copyLinesUp, copyLinesDown, deleteLines
  case insertLineBelow, insertLineAbove, indentLines, outdentLines
  case selectLine, addNextOccurrence, selectAllOccurrences, addCursorAbove, addCursorBelow
  case jumpToBracket, goToLine, nextProblem, previousProblem
  case goToDefinition, triggerCompletion

  public var title: String {
    switch self {
    case .toggleLineComment: "Toggle Line Comment"
    case .toggleBlockComment: "Toggle Block Comment"
    case .moveLinesUp: "Move Line Up"
    case .moveLinesDown: "Move Line Down"
    case .copyLinesUp: "Copy Line Up"
    case .copyLinesDown: "Copy Line Down"
    case .deleteLines: "Delete Line"
    case .insertLineBelow: "Insert Line Below"
    case .insertLineAbove: "Insert Line Above"
    case .indentLines: "Indent Line"
    case .outdentLines: "Outdent Line"
    case .selectLine: "Select Line"
    case .addNextOccurrence: "Add Next Occurrence"
    case .selectAllOccurrences: "Select All Occurrences"
    case .addCursorAbove: "Add Cursor Above"
    case .addCursorBelow: "Add Cursor Below"
    case .jumpToBracket: "Go to Bracket"
    case .goToLine: "Go to Line…"
    case .nextProblem: "Next Problem"
    case .previousProblem: "Previous Problem"
    case .goToDefinition: "Go to Definition"
    case .triggerCompletion: "Show Completions"
    }
  }

  public var shortcut: EditorShortcut {
    switch self {
    case .toggleLineComment: EditorShortcut("/", .command)
    case .toggleBlockComment: EditorShortcut("a", [.shift, .option])
    case .moveLinesUp: EditorShortcut(.upArrow, .option)
    case .moveLinesDown: EditorShortcut(.downArrow, .option)
    case .copyLinesUp: EditorShortcut(.upArrow, [.shift, .option])
    case .copyLinesDown: EditorShortcut(.downArrow, [.shift, .option])
    case .deleteLines: EditorShortcut("k", [.shift, .command])
    case .insertLineBelow: EditorShortcut(.return, .command)
    case .insertLineAbove: EditorShortcut(.return, [.shift, .command])
    case .indentLines: EditorShortcut("]", .command)
    case .outdentLines: EditorShortcut("[", .command)
    case .selectLine: EditorShortcut("l", .command)
    case .addNextOccurrence: EditorShortcut("d", .command)
    case .selectAllOccurrences: EditorShortcut("l", [.shift, .command])
    case .addCursorAbove: EditorShortcut(.upArrow, [.option, .command])
    case .addCursorBelow: EditorShortcut(.downArrow, [.option, .command])
    case .jumpToBracket: EditorShortcut("\\", [.shift, .command])
    case .goToLine: EditorShortcut("g", .control)
    case .nextProblem: EditorShortcut(.function(8), [])
    case .previousProblem: EditorShortcut(.function(8), .shift)
    case .goToDefinition: EditorShortcut(.function(12), [])
    case .triggerCompletion: EditorShortcut(.space, .control)
    }
  }

  /// The command `event` is the shortcut for.
  static func matching(_ event: NSEvent) -> EditorCommand? {
    allCases.first { $0.shortcut.matches(event) }
  }
}

/// A key plus modifiers, usable both as a SwiftUI menu shortcut and to match an `NSEvent`.
public struct EditorShortcut: Hashable, Sendable {
  public let key: KeyEquivalent
  public let modifiers: EventModifiers

  public init(_ key: KeyEquivalent, _ modifiers: EventModifiers) {
    self.key = key
    self.modifiers = modifiers
  }

  public static func == (lhs: EditorShortcut, rhs: EditorShortcut) -> Bool {
    lhs.key.character == rhs.key.character && lhs.modifiers == rhs.modifiers
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(key.character)
    hasher.combine(modifiers.rawValue)
  }

  var eventFlags: NSEvent.ModifierFlags {
    var flags: NSEvent.ModifierFlags = []
    if modifiers.contains(.command) { flags.insert(.command) }
    if modifiers.contains(.option) { flags.insert(.option) }
    if modifiers.contains(.control) { flags.insert(.control) }
    if modifiers.contains(.shift) { flags.insert(.shift) }
    return flags
  }

  /// For an `NSMenuItem`.
  var menuKey: String { String(key.character) }

  func matches(_ event: NSEvent) -> Bool {
    guard event.type == .keyDown else { return false }
    let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
    return flags == eventFlags && Self.baseKey(of: event) == String(key.character).lowercased()
  }

  /// The key without modifiers, so ⇧⌘\ isn't read as `|`. Arrows and F-keys keep AppKit's characters.
  static func baseKey(of event: NSEvent) -> String? {
    if let raw = event.charactersIgnoringModifiers, let scalar = raw.unicodeScalars.first, (0xF700...0xF8FF).contains(scalar.value) {
      return raw
    }
    return event.characters(byApplyingModifiers: [])?.lowercased()
  }
}

extension KeyEquivalent {
  /// F1–F19, as AppKit's function-key characters.
  public static func function(_ number: Int) -> KeyEquivalent {
    KeyEquivalent(Character(UnicodeScalar(UInt32(NSF1FunctionKey + number - 1))!))
  }
}
