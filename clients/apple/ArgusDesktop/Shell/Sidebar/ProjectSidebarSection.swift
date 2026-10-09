import ArgusCore
import ArgusUI
import SwiftUI

/// One project in the sidebar: a header that is also its root checkout, then
/// its worktree sessions under a guide line, as the desktop's sidebar does.
struct ProjectSidebarSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let project: RemoteProject
  let showsHost: Bool
  @Binding var collapsed: Bool

  private var sessions: [RemoteSession] { store.sessionsByRepo[project.repoRoot] ?? [] }
  private var root: RemoteSession? { sessions.first { $0.kind == .projectRoot } }
  private var worktrees: [RemoteSession] { sessions.filter { $0.kind != .projectRoot } }

  var body: some View {
    Section {
      header
      if !collapsed, !worktrees.isEmpty {
        ForEach(worktrees) { session in
          SessionRow(session: session, agents: agents(in: session))
            .padding(.leading, ProjectGuide.indent)
            .overlay(alignment: .leading) { ProjectGuide() }
            .tag(session.id)
            .contextMenu { sessionMenu(session) }
        }
        newSessionRow
      }
    }
  }

  @ViewBuilder private var header: some View {
    let row = ProjectHeader(
      project: project, root: root, worktrees: worktrees,
      rootAgents: root.map(agents(in:)) ?? [],
      projectAgents: sessions.flatMap(agents(in:)),
      showsHost: showsHost, collapsed: $collapsed
    )
    .contextMenu { projectMenu }
    if let root {
      row.tag(root.id)
    } else {
      row
    }
  }

  private var newSessionRow: some View {
    Button {
      model.newSessionProject = project
    } label: {
      Label("New session", systemImage: Icon.plus)
        .font(.sidebarScaled(.subheadline))
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .padding(.leading, ProjectGuide.indent)
    .overlay(alignment: .leading) { ProjectGuide() }
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
    Button("Open in New Tab") { openInTab(session) }
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

/// The vertical line a project's sessions hang from.
private struct ProjectGuide: View {
  @Environment(\.theme) private var theme
  static let indent: CGFloat = 14

  var body: some View {
    Rectangle()
      .fill(theme.border)
      .frame(width: 1)
      // Past the row's own height, so consecutive rows join into one line.
      .padding(.vertical, -12)
      .padding(.leading, 5)
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
