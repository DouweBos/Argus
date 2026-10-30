import ArgusCore
import ArgusUI
import SwiftUI

/// The side panel: a tab strip over the tab in front. Terminals stay drawn
/// while the panel is up, so switching between them is instant.
struct SidePanel: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model
  @Environment(TerminalsStore.self) private var terminals
  let sessionId: String?
  @State private var search = TerminalSearchState()

  private var session: RemoteSession? { sessionId.flatMap(model.session) }
  private var ready: Bool { session?.status == .ready }
  private var terminalIds: [String]? { model.panelTerminalIds(sessionId) }
  private var tabs: [PanelTab] { model.panels.tabs(sessionId, terminals: terminalIds) }
  private var selected: PanelTab? { model.panels.selected(sessionId, terminals: terminalIds) }

  var body: some View {
    let tabs = tabs
    let selected = selected
    VStack(spacing: 0) {
      SidePanelTabStrip(sessionId: sessionId, tabs: tabs, selected: selected)
      Divider()
      ZStack {
        if tabs.isEmpty { SidePanelEmpty() }
        if let sessionId, ready {
          ForEach(tabs.filter { $0.kind == .terminal }) { tab in
            let front = tab == selected
            TerminalSurface(
              terminalId: tab.terminalId ?? "", isActive: front, search: search,
              onNewTab: { model.addPanelTab(.terminal, via: .shortcut) },
              onClose: { if terminals.tabs(sessionId).first(where: { $0.id == tab.terminalId })?.closable ?? true { model.closePanelTab(tab, session: sessionId) } }
            )
            .padding(.leading, 6)
            .opacity(front ? 1 : 0)
            .allowsHitTesting(front)
            .accessibilityHidden(!front)
          }
        }
        if let selected, selected.kind != .terminal {
          SidePanelTabContent(tab: selected, sessionId: sessionId)
            .id(selected.id)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      // An overlay, so the bar never widens the panel.
      .overlay(alignment: .topTrailing) {
        if search.visible, selected?.kind == .terminal {
          TerminalFindBar(search: search).padding(8)
        }
      }
    }
    .background(theme.bg)
    .task(id: ready ? sessionId : nil) {
      guard let sessionId, ready else { return }
      await terminals.refresh(sessionId: sessionId)
      model.panels.sync(sessionId, terminals: terminals.tabs(sessionId).map(\.id))
      // Whether the session's branch has a pull request to show.
      if !model.pullRequests.loaded { await model.pullRequests.refresh() }
    }
    // ⇧⌘T brings back the terminal last in front.
    .onChange(of: selected?.terminalId) { _, id in
      if let id, let sessionId { terminals.select(id, in: sessionId) }
    }
  }
}

/// A non-terminal tab's view.
private struct SidePanelTabContent: View {
  @Environment(DesktopModel.self) private var model
  let tab: PanelTab
  let sessionId: String?

  private var session: RemoteSession? { sessionId.flatMap(model.session) }

  var body: some View {
    switch tab.kind {
    case .device:
      RuntimePanel(sessionId: sessionId)
    case .browser:
      RuntimePanel(sessionId: sessionId, browser: true)
    case .terminal:
      EmptyView()
    case .huddleChat:
      if let sessionId, let room = model.huddleRoom(session: sessionId) {
        HuddleChatPanel(huddles: model.huddles, room: room)
      } else {
        EmptyState(icon: tab.kind.symbol, title: "No huddle", body: "Share this agent to chat with the people you let in.")
      }
    case .files, .diff, .pullRequest:
      if let session, session.status == .ready {
        switch tab.kind {
        case .files: SessionFilesTab(session: session)
        case .diff: SessionDiffTab(session: session)
        default: SessionPullRequestTab(session: session)
        }
      } else {
        EmptyState(
          icon: tab.kind.symbol, title: "\(tab.kind.title) unavailable",
          body: session == nil ? "Open a session to see its \(tab.kind.title.lowercased())." : "The session is still being set up.")
      }
    }
  }
}

/// An open panel with no tabs: the kinds there are, one click each.
private struct SidePanelEmpty: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    EmptyState(icon: "sidebar.right", title: "Nothing open", body: "Open a tab from + or one of these.") {
      VStack(spacing: 6) {
        ForEach(PanelTabKind.allCases.filter(model.panelKindAvailable), id: \.self) { kind in
          Button {
            model.addPanelTab(kind, via: .button)
          } label: {
            Label(kind.title, systemImage: kind.symbol).frame(minWidth: 120)
          }
        }
      }
    }
  }
}
