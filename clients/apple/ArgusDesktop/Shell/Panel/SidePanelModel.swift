import ArgusUI
import Foundation
import Observation

/// What a side panel tab shows; the "+" menu lists every kind.
enum PanelTabKind: String, Codable, CaseIterable {
  case browser
  case terminal
  case files
  case diff
  case pullRequest = "pull_request"
  case device
  case huddleChat = "huddle_chat"

  var title: String {
    switch self {
    case .browser: "Browser"
    case .terminal: "Terminal"
    case .files: "Files"
    case .diff: "Diff"
    case .pullRequest: "Pull Request"
    case .device: "Device"
    case .huddleChat: "Huddle Chat"
    }
  }

  var symbol: String {
    switch self {
    case .browser: Icon.web
    case .terminal: Icon.terminal
    case .files: Icon.folder
    case .diff: "plus.forwardslash.minus"
    case .pullRequest: "arrow.triangle.pull"
    case .device: Icon.simulator
    case .huddleChat: "bubble.left.and.bubble.right"
    }
  }

  /// Typed while the "+" menu is open.
  var key: Character {
    switch self {
    case .browser: "b"
    case .terminal: "t"
    case .files: "f"
    case .diff: "d"
    case .pullRequest: "p"
    case .device: "m"
    case .huddleChat: "h"
    }
  }

  /// Off a session only the device and the browser have something to show.
  var needsSession: Bool { self != .browser && self != .device }
}

struct PanelTab: Codable, Hashable, Identifiable {
  var kind: PanelTabKind
  /// The PTY a terminal tab shows; terminals are the one kind that come several at a time.
  var terminalId: String?

  var id: String { terminalId.map { "terminal:\($0)" } ?? kind.rawValue }

  static func terminal(_ id: String) -> PanelTab { PanelTab(kind: .terminal, terminalId: id) }
}

/// One session's side panel, as it was left.
struct PanelState: Codable, Equatable {
  var open = false
  var tabs: [PanelTab] = []
  var selected: String?
  var width: Double?
}

/// The side panel of each session (or of the screens off a session): open or
/// closed, its tabs and width. Closed until the user opens it, and kept per session.
@MainActor
@Observable
final class SidePanelModel {
  static let key = "panel.sessions"
  static let globalKey = RuntimeModel.globalKey
  static let minWidth: CGFloat = 280
  static let idealWidth: CGFloat = 420
  static let maxWidth: CGFloat = 1200

  private let defaults: HomeDefaults
  private(set) var states: [String: PanelState] = [:]
  /// Panels filling the content area; not kept across launches.
  var maximized: Set<String> = []
  @ObservationIgnored private var saveTask: Task<Void, Never>?

  init(defaults: HomeDefaults = .shared) {
    self.defaults = defaults
    states = Self.load(defaults)
  }

  static func key(_ session: String?) -> String { session ?? globalKey }

  func state(_ session: String?) -> PanelState { states[Self.key(session)] ?? PanelState() }
  func isOpen(_ session: String?) -> Bool { state(session).open }
  func isMaximized(_ session: String?) -> Bool { isOpen(session) && maximized.contains(Self.key(session)) }

  /// Picks up what the host handed over on connect.
  func reloadPersisted() {
    let loaded = Self.load(defaults)
    if loaded != states { states = loaded }
  }

  // MARK: Tabs

  /// The stored tabs, terminal ones following the session's PTYs: closed ones
  /// drop out and new ones (a run, an agent's shell) join at the end. `terminals`
  /// nil means they aren't known yet, so the stored ones stand.
  static func tabs(_ stored: [PanelTab], terminals: [String]?) -> [PanelTab] {
    guard let terminals else { return stored }
    let live = Set(terminals)
    var tabs = stored.filter { $0.kind != .terminal || $0.terminalId.map(live.contains) == true }
    let shown = Set(tabs.compactMap(\.terminalId))
    tabs += terminals.filter { !shown.contains($0) }.map(PanelTab.terminal)
    return tabs
  }

  func tabs(_ session: String?, terminals: [String]?) -> [PanelTab] {
    Self.tabs(state(session).tabs, terminals: terminals)
  }

  /// The tab in front: the one last picked, else the first.
  func selected(_ session: String?, terminals: [String]?) -> PanelTab? {
    let tabs = tabs(session, terminals: terminals)
    return tabs.first { $0.id == state(session).selected } ?? tabs.first
  }

  func setOpen(_ open: Bool, session: String?) {
    update(session) { $0.open = open }
    if !open { maximized.remove(Self.key(session)) }
  }

  /// Opens the panel on `tab`, adding it when it isn't there yet.
  func show(_ tab: PanelTab, session: String?, terminals: [String]?) {
    update(session) { state in
      state.tabs = Self.tabs(state.tabs, terminals: terminals)
      if !state.tabs.contains(tab) {
        let after = state.tabs.firstIndex { $0.id == state.selected }.map { $0 + 1 } ?? state.tabs.endIndex
        state.tabs.insert(tab, at: after)
      }
      state.selected = tab.id
      state.open = true
    }
  }

  func select(_ id: String, session: String?) {
    update(session) { $0.selected = id }
  }

  /// Drops a tab; its neighbour takes over, and the panel closes with its last tab.
  func remove(_ id: String, session: String?, terminals: [String]?) {
    update(session) { state in
      var tabs = Self.tabs(state.tabs, terminals: terminals)
      guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
      tabs.remove(at: index)
      if state.selected == id || !tabs.contains(where: { $0.id == state.selected }) {
        state.selected = tabs.isEmpty ? nil : tabs[min(max(index - 1, 0), tabs.count - 1)].id
      }
      state.tabs = tabs
      if tabs.isEmpty { state.open = false }
    }
    if state(session).tabs.isEmpty { maximized.remove(Self.key(session)) }
  }

  /// Drag reordering: `id` moves to where `target` is.
  func move(_ id: String, to target: String, session: String?, terminals: [String]?) {
    update(session) { state in
      var tabs = Self.tabs(state.tabs, terminals: terminals)
      guard id != target, let from = tabs.firstIndex(where: { $0.id == id }),
        let to = tabs.firstIndex(where: { $0.id == target })
      else { return }
      let tab = tabs.remove(at: from)
      tabs.insert(tab, at: to)
      state.tabs = tabs
    }
  }

  /// Settles terminal tabs once the session's PTYs are known, so closed ones don't linger.
  func sync(_ session: String?, terminals: [String]) {
    let tabs = Self.tabs(state(session).tabs, terminals: terminals)
    if tabs != state(session).tabs { update(session) { $0.tabs = tabs } }
  }

  func toggleMaximized(_ session: String?) {
    let key = Self.key(session)
    if maximized.contains(key) { maximized.remove(key) } else { maximized.insert(key) }
  }

  func width(_ session: String?) -> Double { state(session).width ?? Double(Self.idealWidth) }

  func setWidth(_ width: Double, session: String?) {
    update(session) { $0.width = width }
  }

  // MARK: Persistence

  private func update(_ session: String?, _ body: (inout PanelState) -> Void) {
    let key = Self.key(session)
    var state = states[key] ?? PanelState()
    body(&state)
    guard state != states[key] else { return }
    states[key] = state
    scheduleSave()
  }

  /// A drag changes the width every frame; the file and the host hear it once it settles.
  private func scheduleSave() {
    saveTask?.cancel()
    saveTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled else { return }
      self?.save()
    }
  }

  func save() {
    saveTask?.cancel()
    guard let data = try? JSONEncoder().encode(states), let text = String(data: data, encoding: .utf8) else {
      return
    }
    if defaults.string(forKey: Self.key) != text { defaults.set(text, forKey: Self.key) }
  }

  private static func load(_ defaults: HomeDefaults) -> [String: PanelState] {
    guard let text = defaults.string(forKey: key), let data = text.data(using: .utf8) else { return [:] }
    return (try? JSONDecoder().decode([String: PanelState].self, from: data)) ?? [:]
  }
}
