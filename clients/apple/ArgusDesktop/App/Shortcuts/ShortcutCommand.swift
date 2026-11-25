import ArgusCore
import ArgusEditor

/// Where Settings → Keyboard lists a command, in the menus' order.
enum ShortcutArea: String, CaseIterable {
  case app, go, view, agent, git, code, editor

  var title: String {
    switch self {
    case .app: "App"
    case .go: "Go"
    case .view: "Sessions and Panels"
    case .agent: "Agents"
    case .git: "Git"
    case .code: "Code View"
    case .editor: "Editor"
    }
  }
}

/// Every command a key can run: the one catalog menus, the shortcut router, the palette's hints and
/// tooltips read their keys from, through `AppPreferences.shortcutKeymap`. `id` is stored and sent.
struct ShortcutCommand: Hashable, Sendable {
  let id: String
  let title: String
  let area: ShortcutArea
  let scope: ShortcutScope
  let defaultChord: KeyChord?
  var isFixed = false
  /// A fixed two-key chord ("⌘K ⌘0"), which no single key matches.
  var sequence: [KeyChord] = []
  /// What `ShortcutRouter` runs for it; nil leaves the key to the menus and the editor.
  var routed: ShortcutRouter.Resolution? = nil

  static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
  func hash(into hasher: inout Hasher) { hasher.combine(id) }

  var definition: ShortcutDefinition {
    ShortcutDefinition(id: id, scope: scope, defaultChord: defaultChord, isFixed: isFixed)
  }

  private init(
    _ id: String, _ title: String, _ area: ShortcutArea, _ scope: ShortcutScope, _ chord: KeyChord?,
    fixed: Bool = false, routed: ShortcutRouter.Resolution? = nil
  ) {
    self.id = id
    self.title = title
    self.area = area
    self.scope = scope
    defaultChord = chord
    isFixed = fixed
    self.routed = routed
  }

  private static func key(_ key: String, _ modifiers: KeyChord.Modifiers) -> KeyChord { KeyChord(key, modifiers) }

  // MARK: App

  static let newSession = Self("app.new-session", "New Session", .app, .global, key("n", .command))
  static let deleteSession = Self("app.delete-session", "Delete Session", .app, .global, key(KeyChord.Key.delete, .command))
  static let addProject = Self("app.add-project", "Add Project", .app, .global, key("o", .command))
  static let newProjectFromBlueprint = Self(
    "app.new-project-from-blueprint", "New Project from Blueprint", .app, .global, nil)
  static let importCliProjects = Self("app.import-cli-projects", "Import Projects from Claude Code", .app, .global, nil)
  static let openSession = Self("app.open-session", "Open Session", .app, .global, key("o", [.shift, .command]))
  static let commandPalette = Self(
    "app.command-palette", "Command Palette", .app, .global, key("p", [.shift, .command]), routed: .commandPalette)
  static let settings = Self("app.settings", "Settings", .app, .global, key(",", .command), fixed: true)
  static let quit = Self("app.quit", "Quit Argus", .app, .global, key("q", .command), fixed: true)

  // MARK: Go

  static let back = Self("go.back", "Back", .go, .global, key("[", .command))
  static let forward = Self("go.forward", "Forward", .go, .global, key("]", .command))
  static let home = Self("go.home", "App Home", .go, .global, key("h", [.shift, .command]))
  static let inbox = Self("go.inbox", "Inbox", .go, .global, key("i", [.shift, .command]))
  static let automations = Self("go.automations", "Automations", .go, .global, nil)
  static let blueprints = Self("go.blueprints", "Blueprints", .go, .global, nil)
  /// ⌥⌘1–⌥⌘5, in `MenuCommand.screens`' order.
  static let screens: [Self] = MenuCommand.screens.enumerated().map { index, screen in
    Self(
      "go.screen.\(screen.route.pattern)", screen.title, .go, .global, key("\(index + 1)", [.option, .command]))
  }

  static func screen(_ route: DesktopRoute) -> Self? { screens.first { $0.id == "go.screen.\(route.pattern)" } }

  // MARK: Sessions and panels

  static func panel(_ panel: SessionPanel) -> Self {
    let index = SessionPanel.allCases.firstIndex(of: panel) ?? 0
    return Self("view.panel.\(panel.rawValue)", "\(panel.title) View", .view, .global, key("\(index + 1)", .command))
  }

  static let newTab = Self("view.new-tab", "New Tab", .view, .global, key("t", [.option, .command]))
  static let closeTab = Self("view.close-tab", "Close Tab", .view, .global, key("w", .command), fixed: true)
  static let nextTab = Self("view.next-tab", "Show Next Tab", .view, .global, key(KeyChord.Key.tab, .control))
  static let previousTab = Self(
    "view.previous-tab", "Show Previous Tab", .view, .global, key(KeyChord.Key.tab, [.control, .shift]))
  static let sidePanel = Self("view.side-panel", "Show or Hide Side Panel", .view, .global, key("j", .command))
  static let terminalTab = Self("view.terminal-tab", "Terminal Tab", .view, .global, key("t", [.shift, .command]))
  static let deviceTab = Self("view.device-tab", "Device Tab", .view, .global, key("b", [.option, .command]))

  // MARK: Agents

  static let newAgent = Self("agent.new", "New Agent", .agent, .global, key("a", [.shift, .command]))
  /// The agent view's own ⌘T: agents are its tabs.
  static let newAgentTab = Self("agent.new-tab", "New Agent in the Agent View", .agent, .session, key("t", .command))
  static let interruptAgent = Self("agent.interrupt", "Interrupt Agent", .agent, .global, key(".", .command))
  static let focusComposer = Self("agent.focus-composer", "Focus Chat Input", .agent, .global, key("l", .command))
  static let nextAgent = Self("agent.next", "Show Next Agent", .agent, .global, key("]", [.shift, .command]))
  static let previousAgent = Self("agent.previous", "Show Previous Agent", .agent, .global, key("[", [.shift, .command]))
  /// ⌃⌘1–⌃⌘9: ⌘1–⌘3 are the session's views.
  static let agents: [Self] = (0..<9).map {
    Self("agent.select.\($0 + 1)", "Agent \($0 + 1)", .agent, .global, key("\($0 + 1)", [.control, .command]))
  }

  // MARK: Git

  static func git(_ action: GitMenuAction) -> Self {
    gitCommands[action] ?? Self("git.\(action.rawValue)", action.rawValue, .git, .session, nil)
  }

  private static let gitCommands: [GitMenuAction: Self] = Dictionary(
    uniqueKeysWithValues: GitMenuAction.allCases.map { action in
      let (title, scope, chord): (String, ShortcutScope, KeyChord?) =
        switch action {
        case .fetch: ("Fetch", .session, key("f", [.shift, .command]))
        case .pull: ("Pull", .gitPanel, key("p", [.shift, .command]))
        case .push: ("Push", .session, key("u", [.shift, .command]))
        case .branch: ("New Branch", .session, key("b", .command))
        case .merge: ("Merge", .session, key("m", [.shift, .command]))
        case .rebase: ("Rebase", .session, key("r", [.shift, .command]))
        case .createPullRequest: ("Create Pull Request", .session, nil)
        case .commit: ("Commit", .gitPanel, key(KeyChord.Key.return, .command))
        case .stash: ("Stash", .session, key("s", [.shift, .command]))
        case .snapshot: ("Save Snapshot", .gitPanel, key("s", [.option, .command]))
        case .undo: ("Undo Git Action", .gitPanel, key("z", [.option, .command]))
        }
      return (action, Self("git.\(action.rawValue)", title, .git, scope, chord, routed: .git(action)))
    })

  // MARK: Code view

  static let save = Self("code.save", "Save", .code, .code, key("s", .command))
  static let saveAll = Self("code.save-all", "Save All", .code, .code, key("s", [.option, .command]), routed: .saveAll)
  static let findInFiles = Self(
    "code.find-in-files", "Find in Files", .code, .code, key("f", [.shift, .command]), routed: .findInFiles)
  static let toggleNavigator = Self(
    "code.toggle-navigator", "Toggle Navigator", .code, .code, key("b", .command), routed: .toggleNavigator)
  static let toggleProblems = Self(
    "code.toggle-problems", "Toggle Problems", .code, .code, key("m", [.shift, .command]), routed: .toggleProblems)
  static let showFiles = Self("code.show-files", "Show Files", .code, .code, key("e", [.shift, .command]))
  static let showChanges = Self("code.show-changes", "Show Changes", .code, .code, key("g", [.control, .shift]))
  static let toggleTerminal = Self("code.toggle-terminal", "Toggle Terminal", .code, .code, key("`", .control))
  static let wordWrap = Self("code.word-wrap", "Word Wrap", .code, .code, key("z", .option))
  static let formatDocument = Self("code.format", "Format Document", .code, .code, key("f", [.shift, .option]))
  static let renameSymbol = Self("code.rename-symbol", "Rename Symbol", .code, .code, key(KeyChord.Key.function(2), []))
  static let findReferences = Self(
    "code.find-references", "Find References", .code, .code, key(KeyChord.Key.function(12), .shift))
  static let nextEditor = Self("code.next-editor", "Next Editor", .code, .code, key(KeyChord.Key.right, [.option, .command]))
  static let previousEditor = Self(
    "code.previous-editor", "Previous Editor", .code, .code, key(KeyChord.Key.left, [.option, .command]))
  static let sendSelection = Self(
    "code.send-selection", "Send Selection to Agent", .code, .code, key("l", [.option, .command]))

  static func quickOpen(_ entry: QuickOpenModel.Entry) -> Self {
    switch entry {
    case .files: Self("code.go-to-file", entry.title, .code, .code, key("p", .command))
    case .openQuickly: Self("code.open-quickly", entry.title, .code, .code, key("o", [.shift, .command]))
    case .workspaceSymbols: Self("code.workspace-symbols", entry.title, .code, .code, key("t", .command))
    }
  }

  // MARK: Editor

  /// The editor's own keys; ⌘K chords can't be rebound.
  static func editor(_ command: EditorCommand) -> Self {
    let key = KeyChord(command.defaultShortcut)
    guard let prefix = command.chordPrefix else {
      return Self("editor.\(command.rawValue)", command.title, .editor, .editor, key)
    }
    var chord = Self("editor.\(command.rawValue)", command.title, .editor, .editor, nil, fixed: true)
    chord.sequence = [KeyChord(prefix), key]
    return chord
  }

  // MARK: Catalog

  static let all: [Self] =
    [
      newSession, deleteSession, addProject, newProjectFromBlueprint, importCliProjects, openSession, commandPalette,
      settings, quit, back, forward, home, inbox, automations, blueprints,
    ]
    + screens + SessionPanel.allCases.map(panel)
    + [newTab, closeTab, nextTab, previousTab, sidePanel, terminalTab, deviceTab]
    + [newAgent, newAgentTab, interruptAgent, focusComposer, nextAgent, previousAgent] + agents
    + GitMenuAction.allCases.map(git)
    + [save, saveAll, findInFiles, toggleNavigator, toggleProblems, showFiles, showChanges, toggleTerminal]
    + QuickOpenModel.Entry.allCases.map(quickOpen)
    + [nextEditor, previousEditor, findReferences, renameSymbol, formatDocument, wordWrap, sendSelection]
    + EditorCommand.allCases.map(editor)

  private static let byId = Dictionary(all.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

  static func named(_ id: String) -> Self? { byId[id] }

  static let definitions = all.map(\.definition)
}

extension ShortcutCommand {
  /// Its key for a hint, like "⇧⌘P", as Settings → Keyboard has it.
  @MainActor var hint: String? {
    if !sequence.isEmpty { return sequence.map(\.display).joined(separator: " ") }
    return AppPreferences.shared.shortcutKeymap.chord(for: self)?.display
  }

  /// A tooltip naming the key when it has one: "Settings (⌘,)".
  @MainActor func help(_ text: String) -> String {
    hint.map { "\(text) (\($0))" } ?? text
  }
}

extension ShortcutKeymap {
  static let argusDefaults = ShortcutKeymap(definitions: ShortcutCommand.definitions)

  func chord(for command: ShortcutCommand) -> KeyChord? { chord(for: command.id) }
}
