import ArgusCore
import Foundation

/// The side panel's actions: what the toolbar, menus, palette and run controls call.
extension DesktopModel {
  typealias PanelSource = MacTelemetryEvent.PanelSource

  var sidePanelVisible: Bool { panels.isOpen(route.sessionId) }

  /// The session's PTY ids, nil until its terminals are known (or off a session: none).
  func panelTerminalIds(_ session: String?) -> [String]? {
    guard let session else { return [] }
    return terminals.tabsBySession[session].map { $0.map(\.id) }
  }

  func toggleSidePanel(via: PanelSource) {
    let session = route.sessionId
    let shown = !panels.isOpen(session)
    panels.setOpen(shown, session: session)
    MacTelemetry.capture(.panelToggled(shown: shown, via: via))
  }

  /// Whether `kind` has anything to show for the screen in front.
  func panelKindAvailable(_ kind: PanelTabKind) -> Bool {
    guard kind.needsSession else { return true }
    guard let id = route.sessionId, let session = session(id), session.status == .ready else { return false }
    switch kind {
    case .pullRequest: return sessionPullRequest(session) != nil
    case .diff, .files: return !session.isOutsideProjects
    default: return true
    }
  }

  /// The open pull request whose head is the session's branch, among those `gh` lists.
  func sessionPullRequest(_ session: RemoteSession) -> RemotePullRequest? {
    pullRequests.pullRequests.first { $0.repoRoot == session.repoRoot && $0.headRef == session.branch }
  }

  /// ⇧⌘T / ⌥⌘B: brings `kind`'s tab up, or closes the panel when it's already in front.
  func togglePanelTab(_ kind: PanelTabKind, via: PanelSource) {
    let session = route.sessionId
    if panels.isOpen(session), panels.selected(session, terminals: panelTerminalIds(session))?.kind == kind {
      panels.setOpen(false, session: session)
      MacTelemetry.capture(.panelToggled(shown: false, via: via))
      return
    }
    focusPanelTab(kind, via: via)
  }

  /// Opens the panel on a `kind` tab: the one there is, or a new one.
  func focusPanelTab(_ kind: PanelTabKind, via: PanelSource) {
    let session = route.sessionId
    let terminalIds = panelTerminalIds(session)
    if kind == .terminal, let session {
      let existing = terminals.active(session) ?? terminals.tabs(session).last
      guard let existing else { return addPanelTab(.terminal, via: via) }
      panels.show(.terminal(existing.id), session: session, terminals: terminalIds)
    } else {
      guard panelKindAvailable(kind) else { return }
      panels.show(PanelTab(kind: kind), session: session, terminals: terminalIds)
      if kind == .browser { runtime.startBrowser(session: session) }
    }
    MacTelemetry.capture(.panelTabOpened(kind: kind, via: via))
  }

  /// The "+" menu: a new terminal each time, the one tab of every other kind.
  func addPanelTab(_ kind: PanelTabKind, via: PanelSource) {
    guard kind == .terminal else { return focusPanelTab(kind, via: via) }
    guard let id = route.sessionId, let session = session(id), session.status == .ready else { return }
    panels.setOpen(true, session: id)
    MacTelemetry.capture(.panelTabOpened(kind: .terminal, via: via))
    Task {
      // The first terminal of a session opens the project's own (or one shell).
      let before = Set(terminals.tabs(id).map(\.id))
      await terminals.open(sessionId: id, repoRoot: session.repoRoot)
      let created = terminals.tabs(id).first { !before.contains($0.id) }
      let tab: TerminalsStore.Tab?
      if let created {
        tab = created
      } else {
        MacTelemetry.capture(.terminalUsed(action: .newShell))
        tab = await terminals.newShell(sessionId: id)
      }
      if let tab { showTerminal(tab.id, session: id) }
    }
  }

  /// A run's output, or any one terminal, in front in its session's panel.
  func showTerminal(_ terminalId: String, session: String) {
    terminals.select(terminalId, in: session)
    panels.show(.terminal(terminalId), session: session, terminals: panelTerminalIds(session))
  }

  /// Closes a tab; a terminal tab's PTY goes with it.
  func closePanelTab(_ tab: PanelTab, session: String?) {
    guard let terminalId = tab.terminalId else {
      return panels.remove(tab.id, session: session, terminals: panelTerminalIds(session))
    }
    MacTelemetry.capture(.terminalUsed(action: .close))
    // After the PTY is gone, or the still-listed terminal would rejoin as a new tab.
    Task {
      await terminals.close(terminalId)
      panels.remove(tab.id, session: session, terminals: panelTerminalIds(session))
    }
  }
}
