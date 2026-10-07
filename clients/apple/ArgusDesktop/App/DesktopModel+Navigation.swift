import AppKit
import ArgusCore
import Foundation

/// Routes, the machine they read from (`?host=`), and back/forward across both.
extension DesktopModel {
  /// How long a link to a session waits for its host to connect.
  static let pendingLocationTimeout: Duration = .seconds(30)

  /// Where the window is: the route, and the machine unscoped screens show.
  var location: DesktopLocation {
    DesktopLocation(route: route, host: hosts.focused)
  }

  /// A deep link or `navigation:goto` path; unknown paths are ignored.
  func open(path: String) {
    guard let location = DesktopLocation(path: path) else { return }
    NSApp.activate()
    open(location)
  }

  func open(deepLink url: URL) {
    guard let location = DesktopLocation(deepLink: url) else { return }
    open(location)
  }

  /// A path from outside the window — a deep link, the launch route. One to a
  /// session nobody has listed yet waits for its host to connect.
  func open(_ location: DesktopLocation) {
    if let id = location.route.sessionId, !knowsSession(id) {
      pendingLocation = location
      pendingTimeout?.cancel()
      pendingTimeout = Task { [weak self] in
        try? await Task.sleep(for: Self.pendingLocationTimeout)
        guard !Task.isCancelled else { return }
        self?.abandonPendingLocation()
      }
      return
    }
    pendingLocation = nil
    pendingTimeout?.cancel()
    MacTelemetry.capture(.linkOpened(screen: location.route.pattern, outcome: .direct))
    go(to: location)
  }

  /// Called whenever a host's sessions arrive.
  func resolvePendingLocation() {
    guard let location = pendingLocation, let id = location.route.sessionId, knowsSession(id) else {
      return
    }
    pendingLocation = nil
    pendingTimeout?.cancel()
    MacTelemetry.capture(.linkOpened(screen: location.route.pattern, outcome: .waited))
    go(to: location)
  }

  private func abandonPendingLocation() {
    guard let location = pendingLocation else { return }
    pendingLocation = nil
    notificationsLog.push(
      .warning, "The session that link points at isn't on any connected machine.", source: "Links")
    MacTelemetry.capture(.linkOpened(screen: location.route.pattern, outcome: .abandoned))
  }

  func knowsSession(_ id: String) -> Bool {
    store.sessionsByRepo.values.joined().contains { $0.id == id }
      || store.scratchPads.contains { $0.id == id }
  }

  /// A session from the sidebar: the panel it was last on, else its home.
  func open(session id: String) {
    if gitPanelSessions.contains(id) { return openGit(session: id) }
    if agentsPanelSessions.contains(id) { return openAgents(session: id) }
    navigate(.sessionHome(id: id))
  }

  /// A session's agents, on the one last open there, as the desktop keeps
  /// each session's active agent.
  func openAgents(session id: String) {
    navigate(.session(id: id, agentId: lastAgents[id]))
  }

  /// An agent just started or resumed, shown before the host lists it.
  func open(spawned agentId: String, session id: String) {
    spawnedAgent = agentId
    navigate(.session(id: id, agentId: agentId))
  }

  /// A session's git panel, on the sub-view it was last left on.
  func openGit(session id: String) {
    navigate(.sessionGit(id: id, view: gitViews[id] ?? .working))
  }

  func navigate(_ next: DesktopRoute) {
    go(to: DesktopLocation(route: next, host: hosts.focused))
  }

  /// Narrow the sidebar to one machine and show it everywhere else too; nil
  /// shows them all, with this Mac answering what names no machine. A step in
  /// history, like any other change of screen.
  func showMachine(_ hostId: HostId?) {
    let current = location
    machineFilter = hostId
    hosts.focus(hostId ?? Hosts.local)
    guard location != current else { return }
    back.append(current)
    forward = []
    persistTabs()
  }

  private func go(to next: DesktopLocation) {
    let current = location
    guard next != current else { return }
    remember(next.route)
    back.append(current)
    forward = []
    apply(next)
    persistTabs()
    MacTelemetry.capture(.screenViewed(screen: next.route.pattern))
  }

  /// Which panel and git view each session was last left on.
  private func remember(_ route: DesktopRoute) {
    if let id = route.sessionId,
      let session = store.sessionsByRepo.values.joined().first(where: { $0.id == id })
    {
      HomeRecents.shared.show(session.repoRoot)
    }
    switch route {
    case .session(let id, let agentId):
      agentsPanelSessions.insert(id)
      gitPanelSessions.remove(id)
      if let agentId { lastAgents[id] = agentId }
    case .sessionHome(let id):
      agentsPanelSessions.remove(id)
      gitPanelSessions.remove(id)
    case .sessionGit(let id, let view):
      gitPanelSessions.insert(id)
      gitViews[id] = view
    default: break
    }
  }

  /// A location's machine sticks until another names a different one; one
  /// that's no longer attached falls back to this Mac.
  private func apply(_ location: DesktopLocation) {
    let host = location.host ?? Hosts.local
    if host != hosts.focused {
      hosts.focus(host)
      if machineFilter != nil { machineFilter = hosts.focused == Hosts.local ? nil : hosts.focused }
    }
    route = location.route
  }

  var canGoBack: Bool { !back.isEmpty }
  var canGoForward: Bool { !forward.isEmpty }

  func goBack() {
    guard let previous = back.popLast() else { return }
    forward.append(location)
    apply(previous)
    persistTabs()
  }

  func goForward() {
    guard let next = forward.popLast() else { return }
    back.append(location)
    apply(next)
    persistTabs()
  }

  /// A scratch pad on the machine on screen, opened on its first agent.
  func newScratchPad() async {
    guard let agent = await store.createScratchPad() else { return }
    MacTelemetry.capture(.scratchPadCreated)
    open(spawned: agent.agentId, session: agent.sessionId)
  }
}
