import Foundation

/// A key and the modifiers held with it: one command's keyboard shortcut.
///
/// `key` is the unshifted key, lowercased ("]" for ⇧⌘], "f" for ⇧⌘F), or one of `Key`'s names.
public struct KeyChord: Hashable, Sendable, CustomStringConvertible {
  public struct Modifiers: OptionSet, Hashable, Sendable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }

    public static let control = Self(rawValue: 1 << 0)
    public static let option = Self(rawValue: 1 << 1)
    public static let shift = Self(rawValue: 1 << 2)
    public static let command = Self(rawValue: 1 << 3)
  }

  /// Keys that aren't a character.
  public enum Key {
    public static let `return` = "return"
    public static let tab = "tab"
    public static let space = "space"
    public static let delete = "delete"
    public static let forwardDelete = "forwardDelete"
    public static let escape = "escape"
    public static let up = "up"
    public static let down = "down"
    public static let left = "left"
    public static let right = "right"
    public static let home = "home"
    public static let end = "end"
    public static let pageUp = "pageUp"
    public static let pageDown = "pageDown"

    public static func function(_ number: Int) -> String { "f\(number)" }

    static let named: Set<String> = [
      `return`, tab, space, delete, forwardDelete, escape, up, down, left, right, home, end, pageUp, pageDown,
    ]
  }

  public let key: String
  public let modifiers: Modifiers

  public init(_ key: String, _ modifiers: Modifiers) {
    self.key = key.count == 1 ? key.lowercased() : key
    self.modifiers = modifiers
  }

  /// F1–F19.
  public var functionKeyNumber: Int? {
    guard key.count > 1, key.hasPrefix("f"), let number = Int(key.dropFirst()), (1...19).contains(number) else {
      return nil
    }
    return number
  }

  /// Something a shortcut can be: a ⌘, ⌃ or ⌥ chord, or an F-key. Shift alone would type.
  public var isUsable: Bool {
    isValidKey && (!modifiers.subtracting(.shift).isEmpty || functionKeyNumber != nil)
  }

  private var isValidKey: Bool {
    key.count == 1 || Key.named.contains(key) || functionKeyNumber != nil
  }

  // MARK: Display

  /// The modifier glyphs in macOS's order, then the key: "⇧⌘P".
  public var display: String { displayParts.joined() }

  /// One string per key, for a hint that spaces them: ["⇧", "⌘", "F12"].
  public var displayParts: [String] {
    var parts: [String] = []
    if modifiers.contains(.control) { parts.append("⌃") }
    if modifiers.contains(.option) { parts.append("⌥") }
    if modifiers.contains(.shift) { parts.append("⇧") }
    if modifiers.contains(.command) { parts.append("⌘") }
    parts.append(keyGlyph)
    return parts
  }

  public var keyGlyph: String {
    if let number = functionKeyNumber { return "F\(number)" }
    switch key {
    case Key.return: return "↩"
    case Key.tab: return "⇥"
    case Key.space: return "Space"
    case Key.delete: return "⌫"
    case Key.forwardDelete: return "⌦"
    case Key.escape: return "⎋"
    case Key.up: return "↑"
    case Key.down: return "↓"
    case Key.left: return "←"
    case Key.right: return "→"
    case Key.home: return "↖"
    case Key.end: return "↘"
    case Key.pageUp: return "⇞"
    case Key.pageDown: return "⇟"
    default: return key.uppercased()
    }
  }

  public var description: String { display }

  // MARK: Storage

  private static let modifierNames: [(Modifiers, String)] = [
    (.control, "ctrl"), (.option, "opt"), (.shift, "shift"), (.command, "cmd"),
  ]

  /// "shift+cmd+p", as preferences keep it.
  public var storageValue: String {
    (Self.modifierNames.filter { modifiers.contains($0.0) }.map(\.1) + [key]).joined(separator: "+")
  }

  public init?(storageValue: String) {
    var rest = Substring(storageValue)
    var modifiers: Modifiers = []
    var matched = true
    while matched {
      matched = false
      for (modifier, name) in Self.modifierNames where rest.hasPrefix(name + "+") && rest.count > name.count + 1 {
        modifiers.insert(modifier)
        rest = rest.dropFirst(name.count + 1)
        matched = true
      }
    }
    let chord = KeyChord(String(rest), modifiers)
    guard chord.isValidKey else { return nil }
    self = chord
  }
}
