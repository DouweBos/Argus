import Foundation

/// Where a command's key works. A narrower scope takes a key from a wider one while it's in front
/// (the code view's ⇧⌘F finds in files, elsewhere in a session it fetches).
public enum ShortcutScope: String, CaseIterable, Sendable {
  /// Anywhere in the main window.
  case global
  /// A session with a repository on screen.
  case session
  /// The session's code view.
  case code
  /// The git view or the Diff tab.
  case gitPanel
  /// The code view's editor, while it has focus.
  case editor

  /// Which of two commands on one key wins where both are live.
  public var precedence: Int {
    switch self {
    case .global: 0
    case .session: 1
    case .code: 2
    case .gitPanel: 3
    case .editor: 4
    }
  }

  /// Wherever `other` is live, so is this. Code and git never are at once, nor are git and the editor.
  public func encloses(_ other: ShortcutScope) -> Bool {
    switch self {
    case .global: true
    case .session: other != .global
    case .code: other == .code || other == .editor
    case .gitPanel: other == .gitPanel
    case .editor: other == .editor
    }
  }

  public func overlaps(_ other: ShortcutScope) -> Bool { encloses(other) || other.encloses(self) }
}

/// One command a key can be bound to.
public struct ShortcutDefinition: Hashable, Sendable {
  public let id: String
  public let scope: ShortcutScope
  public let defaultChord: KeyChord?
  /// Shown, never rebound: macOS or AppKit owns the key (⌘Q, ⌘W, ⌘,) or it's a two-key chord.
  public let isFixed: Bool

  public init(id: String, scope: ShortcutScope, defaultChord: KeyChord?, isFixed: Bool = false) {
    self.id = id
    self.scope = scope
    self.defaultChord = defaultChord
    self.isFixed = isFixed
  }
}

/// A key macOS or every Mac app already gives a meaning.
public struct SystemShortcut: Hashable, Sendable {
  public let chord: KeyChord
  public let name: String

  public static let all: [SystemShortcut] = [
    .init(KeyChord("q", .command), "Quit"),
    .init(KeyChord("w", .command), "Close"),
    .init(KeyChord("h", .command), "Hide Argus"),
    .init(KeyChord("h", [.option, .command]), "Hide Others"),
    .init(KeyChord("m", .command), "Minimize"),
    .init(KeyChord(",", .command), "Settings"),
    .init(KeyChord("c", .command), "Copy"),
    .init(KeyChord("v", .command), "Paste"),
    .init(KeyChord("x", .command), "Cut"),
    .init(KeyChord("a", .command), "Select All"),
    .init(KeyChord("z", .command), "Undo"),
    .init(KeyChord("z", [.shift, .command]), "Redo"),
    .init(KeyChord("f", .command), "Find"),
    .init(KeyChord(KeyChord.Key.tab, .command), "the app switcher"),
    .init(KeyChord("`", .command), "Cycle Windows"),
    .init(KeyChord(KeyChord.Key.space, .command), "Spotlight"),
    .init(KeyChord(KeyChord.Key.space, [.option, .command]), "Finder search"),
    .init(KeyChord(KeyChord.Key.space, .control), "Select Previous Input Source"),
    .init(KeyChord("3", [.shift, .command]), "Screenshot"),
    .init(KeyChord("4", [.shift, .command]), "Screenshot"),
    .init(KeyChord("5", [.shift, .command]), "Screenshot"),
    .init(KeyChord("q", [.control, .command]), "Lock Screen"),
    .init(KeyChord("f", [.control, .command]), "Full Screen"),
    .init(KeyChord(KeyChord.Key.escape, [.option, .command]), "Force Quit"),
    .init(KeyChord(KeyChord.Key.up, .control), "Mission Control"),
    .init(KeyChord(KeyChord.Key.down, .control), "App Windows"),
    .init(KeyChord(KeyChord.Key.left, .control), "Move Left a Space"),
    .init(KeyChord(KeyChord.Key.right, .control), "Move Right a Space"),
  ]

  init(_ chord: KeyChord, _ name: String) {
    self.chord = chord
    self.name = name
  }

  public static func matching(_ chord: KeyChord) -> SystemShortcut? {
    all.first { $0.chord == chord }
  }
}

/// Every command's key: the defaults with the person's changes laid over them.
public struct ShortcutKeymap: Equatable, Sendable {
  public enum Override: Hashable, Sendable {
    case chord(KeyChord)
    /// No key at all.
    case unbound
  }

  public let definitions: [ShortcutDefinition]
  public private(set) var overrides: [String: Override]
  private let byId: [String: ShortcutDefinition]

  public init(definitions: [ShortcutDefinition], overrides: [String: Override] = [:]) {
    self.definitions = definitions
    byId = Dictionary(definitions.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    self.overrides = [:]
    for (id, override) in overrides { set(id, override) }
  }

  /// Reads what `storage` wrote; unknown commands, fixed ones and unreadable keys are dropped.
  public init(definitions: [ShortcutDefinition], storage: [String: String]) {
    var overrides: [String: Override] = [:]
    for (id, value) in storage {
      if value.isEmpty {
        overrides[id] = .unbound
      } else if let chord = KeyChord(storageValue: value), chord.isUsable {
        overrides[id] = .chord(chord)
      }
    }
    self.init(definitions: definitions, overrides: overrides)
  }

  /// What preferences keep: the changed commands only, "" for one with no key.
  public var storage: [String: String] {
    overrides.mapValues {
      switch $0 {
      case .chord(let chord): chord.storageValue
      case .unbound: ""
      }
    }
  }

  public func definition(_ id: String) -> ShortcutDefinition? { byId[id] }

  public func chord(for id: String) -> KeyChord? {
    switch overrides[id] {
    case .chord(let chord): chord
    case .unbound: nil
    case nil: byId[id]?.defaultChord
    }
  }

  public func isCustomized(_ id: String) -> Bool { overrides[id] != nil }

  public var hasCustomizations: Bool { !overrides.isEmpty }

  /// Binds `id` to `chord`, or to nothing; its default again drops the change.
  public mutating func bind(_ id: String, to chord: KeyChord?) {
    set(id, chord.map(Override.chord) ?? .unbound)
  }

  public mutating func reset(_ id: String) { overrides[id] = nil }

  public mutating func resetAll() { overrides = [:] }

  private mutating func set(_ id: String, _ override: Override) {
    guard let definition = byId[id], !definition.isFixed else { return }
    let chord: KeyChord? =
      switch override {
      case .chord(let chord): chord
      case .unbound: nil
      }
    overrides[id] = chord == definition.defaultChord ? nil : override
  }

  // MARK: Conflicts

  /// Other commands on `id`'s key where both are live. Argus's own defaults layer on purpose
  /// (a narrower scope takes the key), so only two defaults in the very same scope clash.
  public func conflicts(for id: String) -> [String] {
    guard let definition = byId[id], let key = chord(for: id) else { return [] }
    return definitions.filter { other in
      guard other.id != id, self.chord(for: other.id) == key, definition.scope.overlaps(other.scope) else {
        return false
      }
      let layered = !isCustomized(id) && !isCustomized(other.id) && definition.scope != other.scope
      return !layered
    }.map(\.id)
  }

  /// Every command that clashes with another.
  public var conflictingIds: Set<String> {
    Set(definitions.map(\.id).filter { !conflicts(for: $0).isEmpty })
  }

  /// What macOS does with `id`'s key, once the person has put it there.
  public func systemShortcut(for id: String) -> SystemShortcut? {
    guard isCustomized(id), let key = chord(for: id) else { return nil }
    return SystemShortcut.matching(key)
  }

  /// The command `chord` runs with `scopes` live: the narrowest scope's, then the catalog's order.
  public func command(for chord: KeyChord, in scopes: Set<ShortcutScope>) -> String? {
    var best: ShortcutDefinition?
    for definition in definitions where scopes.contains(definition.scope) && self.chord(for: definition.id) == chord {
      if best.map({ definition.scope.precedence > $0.scope.precedence }) ?? true { best = definition }
    }
    return best?.id
  }
}
