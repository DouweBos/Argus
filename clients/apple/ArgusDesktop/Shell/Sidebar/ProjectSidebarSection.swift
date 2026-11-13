import ArgusCore
import ArgusUI
import SwiftUI

/// One project in the sidebar: a header that is also its root checkout, then
/// its worktree sessions as flat rows, working ones first, done and snoozed ones folded.
/// Those that need you sit in the sidebar's Needs you section instead.
struct ProjectSidebarSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let project: RemoteProject
  let showsHost: Bool
  /// The sessions the sidebar's search leaves; nil when not searching.
  let shown: Set<String>?
  @Binding var collapsed: Bool
  /// Which projects show their done and snoozed sessions.
  let folds: SidebarCollapse

  private var sessions: [RemoteSession] { store.sessionsByRepo[project.repoRoot] ?? [] }
  private var root: RemoteSession? { sessions.first { $0.kind == .projectRoot } }
  private var worktrees: [RemoteSession] { sessions.filter { $0.kind != .projectRoot } }

  var body: some View {
    let visible = SessionSearch.visibleWorktrees(worktrees, shown: shown, collapsed: collapsed)
    let triage = SessionTriage(visible) { store.agents(inSession: $0) }
    VStack(alignment: .leading, spacing: 1) {
      header
      if shown != nil {
        // A search shows every match where it sits, folded or not; Needs you stays on top.
        SidebarSessionRows(sessions: triage.active + triage.folded)
      } else {
        SidebarSessionRows(sessions: triage.active)
        FoldedSessions(triage: triage, expanded: folds.binding(project.repoRoot, triage: triage))
      }
    }
  }

  @ViewBuilder private var header: some View {
    let row = ProjectHeader(
      project: project, root: root, worktrees: worktrees,
      rootAgents: root.map(agents(in:)) ?? [],
      showsHost: showsHost, collapsed: $collapsed)
    SidebarRow(
      selected: root.map { model.route.sessionId == $0.id } ?? false,
      enabled: root.map { !$0.isUnavailable } ?? false
    ) {
      if let root { model.open(session: root.id) }
    } content: {
      row
    }
    .contextMenu { projectMenu }
  }

  @ViewBuilder private var projectMenu: some View {
    Button("New Session…") { model.newSessionProject = project }
    Button("Project Settings…") { model.projectSettingsRepo = project.repoRoot }
    if let root {
      Button("Open in New Tab") { openInTab(root) }
      PullRequestWatchButton(session: root)
    }
    if !worktrees.isEmpty {
      Button(collapsed ? "Expand" : "Collapse") { collapsed.toggle() }
    }
  }

  private func openInTab(_ session: RemoteSession) {
    model.openTab(DesktopLocation(route: .session(id: session.id, agentId: nil), host: model.host(ofSession: session.id)))
  }

  private func agents(in session: RemoteSession) -> [RemoteAgentStatus] {
    store.agents(inSession: session)
  }
}

/// A clickable sidebar row: a quiet fill when selected, fainter on hover.
/// A tap rather than a button, so the controls inside it still get their clicks.
struct SidebarRow<Content: View>: View {
  @Environment(\.theme) private var theme
  let selected: Bool
  var enabled = true
  let action: () -> Void
  @ViewBuilder let content: Content
  @State private var hovering = false

  var body: some View {
    content
      .padding(.horizontal, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background {
        if selected || (hovering && enabled) {
          RoundedRectangle(cornerRadius: 6).fill(theme.selection.opacity(selected ? 1 : 0.55))
        }
      }
      .contentShape(.rect(cornerRadius: 6))
      .onHover { hovering = $0 }
      .onTapGesture { if enabled { action() } }
      .clickable(enabled)
      .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
      .accessibilityAction { if enabled { action() } }
  }
}

/// Which projects are folded shut (or show their done sessions), kept per Argus home.
@MainActor @Observable
final class SidebarCollapse {
  private let key: String
  private var collapsed: Set<String>

  /// `key` names the set: folded projects by default, or the projects showing their done sessions.
  init(key: String = "sidebar.collapsedProjects") {
    self.key = key
    collapsed = Set(HomeDefaults.shared.stringArray(forKey: key) ?? [])
  }

  func isCollapsed(_ repoRoot: String) -> Bool { collapsed.contains(repoRoot) }

  func binding(_ repoRoot: String) -> Binding<Bool> {
    Binding(
      get: { self.collapsed.contains(repoRoot) },
      set: { isCollapsed in
        if isCollapsed { self.collapsed.insert(repoRoot) } else { self.collapsed.remove(repoRoot) }
        HomeDefaults.shared.set(self.collapsed.sorted(), forKey: self.key)
        MacTelemetry.capture(.sidebarProjectToggled(collapsed: isCollapsed))
      })
  }

  /// The same set read as "expanded": a fold of done and snoozed sessions.
  func binding(_ id: String, triage: SessionTriage) -> Binding<Bool> {
    Binding(
      get: { self.collapsed.contains(id) },
      set: { expanded in
        if expanded { self.collapsed.insert(id) } else { self.collapsed.remove(id) }
        HomeDefaults.shared.set(self.collapsed.sorted(), forKey: self.key)
        MacTelemetry.capture(
          .sidebarFoldToggled(expanded: expanded, done: triage.done.count, snoozed: triage.snoozed.count))
      })
  }
}
