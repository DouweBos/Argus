import ArgusCore
import ArgusUI
import SwiftUI

/// Projects and their sessions, live from every attached host: search and
/// actions on top, the everyday screens, a flat list, and the rest along the bottom.
struct SidebarView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme
  @State private var collapse = SidebarCollapse()
  @State private var filter = SidebarFilter()
  /// Clicking a row focuses the list, so ↑ and ↓ carry on from there.
  @FocusState private var listFocused: Bool

  var body: some View {
    VStack(spacing: 0) {
      SidebarTopBar(filter: filter, showsHosts: showsHosts)
      SidebarNav()
      sessionList
      if store.connection != .ready {
        ConnectionBadge(state: store.connection).padding(8)
      }
      SidebarBottomBar()
    }
    .background(theme.sidebar.ignoresSafeArea())
    .sheet(item: newSessionProject) { project in
      NewSessionSheet(project: project) { session in
        model.openAgents(session: session.id)
      }
    }
    .sheet(item: deletingSession) { session in
      DeleteSessionSheet(session: session) {
        if model.route.sessionId == session.id { model.navigate(.home) }
      }
    }
    .renameSessionAlert()
  }

  private var sessionList: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 10) {
        if projects.isEmpty, store.projectsLoaded {
          Text(filter.isActive ? "Nothing matches" : "No projects yet")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
            .padding(.horizontal, 8)
        }
        ForEach(projects) { project in
          ProjectSidebarSection(
            project: project, showsHost: showsHosts, shown: shownSessions,
            collapsed: collapse.binding(project.repoRoot))
        }
        if !scratchPads.isEmpty || !filter.isActive {
          scratchPadSection
        }
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 6)
    }
    .scrollIndicators(.never)
    .focusable()
    .focusEffectDisabled()
    .focused($listFocused)
    .simultaneousGesture(TapGesture().onEnded { listFocused = true })
    .onMoveCommand(perform: move)
  }

  private var scratchPadSection: some View {
    VStack(alignment: .leading, spacing: 1) {
      HStack {
        Text("Scratch pads")
          .font(.scaled(size: 11, weight: .medium))
          .foregroundStyle(theme.textMuted)
        Rectangle().fill(theme.border).frame(height: 1)
        Button {
          Task { await model.newScratchPad() }
        } label: {
          Label("New scratch pad", systemImage: Icon.plus)
        }
        .buttonStyle(FlatIconButtonStyle(size: 20))
        .help("New scratch pad")
      }
      .padding(.leading, 8)
      ForEach(scratchPads) { pad in
        SidebarRow(selected: model.route.sessionId == pad.id) {
          model.open(session: pad.id)
        } content: {
          SidebarSessionRow(session: pad, agents: agents(in: pad))
        }
        .contextMenu {
          Button("Open in New Tab") {
            model.openTab(DesktopLocation(route: .session(id: pad.id, agentId: nil), host: model.host(ofSession: pad.id)))
          }
          Button("Rename Scratch Pad…") { model.renamingSession = pad }
          Button("Delete Scratch Pad…") { model.deletingSession = pad }
        }
      }
    }
  }

  /// ↑ and ↓ step through the rows as they're shown.
  private func move(_ direction: MoveCommandDirection) {
    let step = direction == .down ? 1 : direction == .up ? -1 : 0
    guard step != 0 else { return }
    let ids = visibleSessionIds
    guard !ids.isEmpty else { return }
    let current = model.route.sessionId.flatMap { ids.firstIndex(of: $0) }
    let next = current.map { min(max($0 + step, 0), ids.count - 1) } ?? (step > 0 ? 0 : ids.count - 1)
    if ids[next] != model.route.sessionId { model.open(session: ids[next]) }
  }

  private var visibleSessionIds: [String] {
    let listed = projects.flatMap { project -> [RemoteSession] in
      let sessions = store.sessionsByRepo[project.repoRoot] ?? []
      let root = sessions.filter { $0.kind == .projectRoot }
      let worktrees = SessionSearch.visibleWorktrees(
        sessions.filter { $0.kind != .projectRoot }, shown: shownSessions,
        collapsed: collapse.isCollapsed(project.repoRoot))
      return root + worktrees
    }
    return (listed + scratchPads).filter { !$0.isUnavailable }.map(\.id)
  }

  private var deletingSession: Binding<RemoteSession?> {
    Binding(get: { model.deletingSession }, set: { model.deletingSession = $0 })
  }

  private var newSessionProject: Binding<RemoteProject?> {
    Binding(get: { model.newSessionProject }, set: { model.newSessionProject = $0 })
  }

  /// Hosts are only worth naming once there is more than this Mac.
  private var showsHosts: Bool { !hosts.attached.isEmpty }

  /// Sessions the search matches, by title, branch or project name; nil when not searching.
  private var shownSessions: Set<String>? {
    guard filter.isSearching else { return nil }
    let all = store.projects.flatMap { project in
      (store.sessionsByRepo[project.repoRoot] ?? []).filter {
        SessionSearch.matches($0, projectName: project.name, query: filter.query)
      }
    }
    return Set(all.map(\.id))
  }

  /// This Mac's projects first, then each host's in pairing order, narrowed to
  /// the machine and project picked, and to the search's matches.
  private var projects: [RemoteProject] {
    let shown = shownSessions
    let narrowed = store.projects
      .filter { model.machineFilter == nil || model.host(ofProject: $0.repoRoot) == model.machineFilter }
      .filter { filter.project == nil || filter.project == $0.repoRoot }
      .filter { project in
        guard let shown else { return true }
        return (store.sessionsByRepo[project.repoRoot] ?? []).contains { shown.contains($0.id) }
      }
    return SessionSearch.ordered(narrowed, by: hosts.machines) { model.host(ofProject: $0.repoRoot) }
  }

  private var scratchPads: [RemoteSession] {
    guard filter.project == nil else { return [] }
    return store.scratchPads.filter {
      (model.machineFilter == nil || model.host(ofSession: $0.id) == model.machineFilter)
        && (!filter.isSearching || SessionSearch.matches($0, projectName: nil, query: filter.query))
    }
  }

  private func agents(in session: RemoteSession) -> [RemoteAgentStatus] {
    store.agents(inSession: session)
  }
}
