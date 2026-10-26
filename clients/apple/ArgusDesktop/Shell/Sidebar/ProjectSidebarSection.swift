import ArgusCore
import ArgusUI
import SwiftUI

/// One project in the sidebar: a header that is also its root checkout, then
/// its worktree sessions as flat rows.
struct ProjectSidebarSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let project: RemoteProject
  let showsHost: Bool
  /// The sessions the sidebar's search leaves; nil when not searching.
  let shown: Set<String>?
  @Binding var collapsed: Bool

  private var sessions: [RemoteSession] { store.sessionsByRepo[project.repoRoot] ?? [] }
  private var root: RemoteSession? { sessions.first { $0.kind == .projectRoot } }
  private var worktrees: [RemoteSession] { sessions.filter { $0.kind != .projectRoot } }

  /// Worktrees to list: the search's matches, else all unless folded shut.
  static func visibleWorktrees(_ worktrees: [RemoteSession], shown: Set<String>?, collapsed: Bool) -> [RemoteSession] {
    if let shown { return worktrees.filter { shown.contains($0.id) } }
    return collapsed ? [] : worktrees
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      header
      ForEach(Self.visibleWorktrees(worktrees, shown: shown, collapsed: collapsed)) { session in
        SidebarRow(selected: model.route.sessionId == session.id, enabled: !session.isUnavailable) {
          model.open(session: session.id)
        } content: {
          SessionRow(session: session, agents: agents(in: session))
        }
        .contextMenu { sessionMenu(session) }
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
    }
    if !worktrees.isEmpty {
      Button(collapsed ? "Expand" : "Collapse") { collapsed.toggle() }
    }
  }

  @ViewBuilder private func sessionMenu(_ session: RemoteSession) -> some View {
    if !session.isUnavailable {
      Button("Open in New Tab") { openInTab(session) }
    }
    if session.kind == .worktree {
      Button("Delete Session…") { model.deletingSession = session }
    }
  }

  private func openInTab(_ session: RemoteSession) {
    model.openTab(DesktopLocation(route: .sessionHome(id: session.id), host: model.host(ofSession: session.id)))
  }

  private func agents(in session: RemoteSession) -> [RemoteAgentStatus] {
    (store.agentsByRepo[session.repoRoot] ?? []).filter { $0.sessionId == session.id }
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
      .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
      .accessibilityAction { if enabled { action() } }
  }
}

/// Which projects are folded shut, kept per Argus home.
@MainActor @Observable
final class SidebarCollapse {
  private static let key = "sidebar.collapsedProjects"
  private var collapsed: Set<String>

  init() {
    collapsed = Set(HomeDefaults.shared.stringArray(forKey: Self.key) ?? [])
  }

  func isCollapsed(_ repoRoot: String) -> Bool { collapsed.contains(repoRoot) }

  func binding(_ repoRoot: String) -> Binding<Bool> {
    Binding(
      get: { self.collapsed.contains(repoRoot) },
      set: { isCollapsed in
        if isCollapsed { self.collapsed.insert(repoRoot) } else { self.collapsed.remove(repoRoot) }
        HomeDefaults.shared.set(self.collapsed.sorted(), forKey: Self.key)
        MacTelemetry.capture(.sidebarProjectToggled(collapsed: isCollapsed))
      })
  }
}
