import ArgusCore
import Foundation

/// A window tab: a saved location plus its own back / forward, as Electron's
/// `tabStore` keeps them. The pinned "This Mac" tab is always first.
struct WindowTab: Identifiable, Equatable {
  static let localId = "tab-local"

  let id: String
  var location: DesktopLocation
  var history = NavigationHistory()
  var pinned: Bool { id == Self.localId }

  /// What persists: the path (its host rides in `?host=`), never the history.
  private struct Saved: Codable {
    let id: String
    let path: String
  }

  private static let tabsKey = "window.tabs"
  private static let activeKey = "window.activeTab"

  @MainActor
  static func restored() -> [WindowTab] {
    let saved = HomeDefaults.shared.data(forKey: tabsKey)
      .flatMap { try? JSONDecoder().decode([Saved].self, from: $0) } ?? []
    let tabs = saved.compactMap { entry in
      DesktopLocation(path: entry.path).map { WindowTab(id: entry.id, location: $0) }
    }
    let local = tabs.first { $0.pinned } ?? WindowTab(id: localId, location: .init(route: .home))
    return [local] + tabs.filter { !$0.pinned }
  }

  @MainActor
  static func restoredActive() -> String {
    HomeDefaults.shared.string(forKey: activeKey) ?? localId
  }

  @MainActor
  static func save(_ tabs: [WindowTab], active: String) {
    let saved = tabs.map { Saved(id: $0.id, path: $0.location.path) }
    HomeDefaults.shared.set(try? JSONEncoder().encode(saved), forKey: tabsKey)
    HomeDefaults.shared.set(active, forKey: activeKey)
  }
}

extension DesktopModel {
  var activeTab: WindowTab? { tabs.first { $0.id == activeTabId } }

  /// Open a tab on `location` (the current one when nil) and switch to it.
  func openTab(_ location: DesktopLocation? = nil) {
    stashActiveTab()
    let tab = WindowTab(id: UUID().uuidString, location: location ?? self.location)
    tabs.append(tab)
    load(tab)
    MacTelemetry.capture(.tabUsed(action: .open))
  }

  /// A machine in a tab: the one already showing it, else a new one on its home.
  func openHostTab(_ hostId: HostId) {
    if let existing = tabs.first(where: { ($0.location.host ?? Hosts.local) == hostId }) {
      return switchTab(existing.id)
    }
    openTab(DesktopLocation(route: .home, host: hostId))
  }

  func switchTab(_ id: String) {
    guard id != activeTabId, let tab = tabs.first(where: { $0.id == id }) else { return }
    stashActiveTab()
    load(tab)
    MacTelemetry.capture(.tabUsed(action: .switch))
  }

  /// Closing a tab is a view change only: its host stays attached.
  func closeTab(_ id: String? = nil) {
    let id = id ?? activeTabId
    guard let index = tabs.firstIndex(where: { $0.id == id }), !tabs[index].pinned else { return }
    stashActiveTab()
    tabs.remove(at: index)
    if id == activeTabId { load(tabs[min(index, tabs.count - 1)]) } else { persistTabs() }
    MacTelemetry.capture(.tabUsed(action: .close))
  }

  /// ⌃Tab / ⌃⇧Tab.
  func cycleTab(by offset: Int) {
    guard tabs.count > 1, let index = tabs.firstIndex(where: { $0.id == activeTabId }) else { return }
    switchTab(tabs[(index + offset + tabs.count) % tabs.count].id)
  }

  /// A tab's label names its screen, and its machine when that isn't this one.
  func title(of tab: WindowTab) -> String {
    let location = tab.id == activeTabId ? self.location : tab.location
    let screen: String
    switch location.route {
    case .home: screen = tab.pinned && location.host == nil ? "This Mac" : "Home"
    case .agents: screen = "Agents"
    case .runtimes: screen = "Runtimes"
    case .devices, .device: screen = "Devices"
    case .pullRequests: screen = "Pull Requests"
    case .pullRequest(let repo, let number): screen = "\(repo)#\(number)"
    case .automations, .automation, .quickRun: screen = "Automations"
    case .inbox, .proposal: screen = "Inbox"
    case .notifications: screen = "Notifications"
    case .session, .sessionHome, .sessionGit, .sessionCode:
      let id = location.route.sessionId ?? ""
      let session = store.sessionsByRepo.values.joined().first { $0.id == id }
        ?? store.scratchPads.first { $0.id == id }
      screen = session.map { $0.displayName ?? $0.branch } ?? "Session"
    }
    let host = location.route.sessionId.map(host(ofSession:)) ?? location.host ?? Hosts.local
    return host == Hosts.local ? screen : "\(screen) — \(hosts.label(host))"
  }

  /// The active tab's live state back into its record.
  private func stashActiveTab() {
    guard let index = tabs.firstIndex(where: { $0.id == activeTabId }) else { return }
    tabs[index].location = location
    tabs[index].history = history
  }

  private func load(_ tab: WindowTab) {
    activeTabId = tab.id
    history = tab.history
    let host = tab.location.host ?? Hosts.local
    if host != hosts.focused {
      hosts.focus(host)
      if machineFilter != nil { machineFilter = hosts.focused == Hosts.local ? nil : hosts.focused }
    }
    route = tab.location.route
    persistTabs()
  }

  /// Saved on every change of screen, so a relaunch restores each tab's place.
  func persistTabs() {
    stashActiveTab()
    WindowTab.save(tabs, active: activeTabId)
  }

  /// At launch: back on the tab that was showing, unless something else
  /// already picked a screen.
  func restoreActiveTab() {
    guard route == .home, pendingLocation == nil, let tab = activeTab, tab.location.route != .home || tab.location.host != nil
    else { return }
    open(tab.location)
  }
}
