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
  @State private var folds = SidebarCollapse(key: "sidebar.expandedFolds")
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
    .snoozeSessionSheet()
  }

  private var sessionList: some View {
    ScrollView {
      // Not lazy: a few uneven project sections send LazyVStack's height estimates into a layout loop.
      VStack(alignment: .leading, spacing: 10) {
        if projects.isEmpty, store.projectsLoaded {
          Text(filter.isActive ? "Nothing matches" : "No projects yet")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
            .padding(.horizontal, 8)
        }
        if !needsYou.isEmpty {
          NeedsYouSidebarSection(sessions: needsYou)
        }
        ForEach(projects) { project in
          ProjectSidebarSection(
            project: project, showsHost: showsHosts, shown: shownSessions,
            collapsed: collapse.binding(project.repoRoot), folds: folds)
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
    let triage = SessionTriage(scratchPads) { agents(in: $0) }
    return VStack(alignment: .leading, spacing: 1) {
      SidebarSectionHeader(title: "Scratch pads") {
        Button {
          Task { await model.newScratchPad() }
        } label: {
          Label("New scratch pad", systemImage: Icon.plus)
        }
        .buttonStyle(FlatIconButtonStyle(size: 20))
        .help("New scratch pad")
      }
      if filter.isSearching {
        SidebarSessionRows(sessions: triage.active + triage.folded)
      } else {
        SidebarSessionRows(sessions: triage.active)
        FoldedSessions(triage: triage, expanded: folds.binding(Self.scratchPadFold, triage: triage))
      }
    }
  }

  private static let scratchPadFold = "scratch-pads"

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

  /// In the order they're drawn: Needs you, then each project's root, active
  /// sessions and any unfolded done ones, then the scratch pads.
  private var visibleSessionIds: [String] {
    func rows(_ sessions: [RemoteSession], fold: String) -> [RemoteSession] {
      let triage = SessionTriage(sessions) { agents(in: $0) }
      return triage.active + (filter.isSearching || folds.isCollapsed(fold) ? triage.folded : [])
    }
    let listed = projects.flatMap { project -> [RemoteSession] in
      let sessions = store.sessionsByRepo[project.repoRoot] ?? []
      let root = sessions.filter { $0.kind == .projectRoot }
      let worktrees = SessionSearch.visibleWorktrees(
        sessions.filter { $0.kind != .projectRoot }, shown: shownSessions,
        collapsed: collapse.isCollapsed(project.repoRoot))
      return root + rows(worktrees, fold: project.repoRoot)
    }
    return (needsYou + listed + rows(scratchPads, fold: Self.scratchPadFold)).filter { !$0.isUnavailable }.map(\.id)
  }

  /// Sessions waiting on you across the projects shown, folded shut or not, then scratch pads.
  private var needsYou: [RemoteSession] {
    let shown = shownSessions
    let worktrees = projects.flatMap { project in
      (store.sessionsByRepo[project.repoRoot] ?? []).filter {
        $0.kind != .projectRoot && (shown?.contains($0.id) ?? true)
      }
    }
    return SessionTriage(worktrees + scratchPads) { agents(in: $0) }.needsYou
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
