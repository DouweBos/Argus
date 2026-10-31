import ArgusCore
import ArgusUI
import SwiftUI

/// `/agents`: every agent the host has, across sessions and projects.
struct AgentsOverview: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var selection: Set<String> = []

  struct Row: Identifiable {
    let agent: RemoteAgentStatus
    let session: RemoteSession?
    var id: String { agent.agentId }
  }

  private var rows: [Row] {
    let sessions = Dictionary(
      store.sessionsByRepo.values.joined().map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    return store.recentAgentsByActivity.map { Row(agent: $0, session: sessions[$0.sessionId]) }
  }

  var body: some View {
    let rows = rows
    VStack(alignment: .leading, spacing: 0) {
      OverviewHeader(title: "Agents", summary: AgentsOverviewList.summary(rows.map(\.agent)))
      if rows.isEmpty {
        EmptyState(
          icon: "sparkles", title: "No agents",
          body: "No agents running. Start one from a session to see it here."
        )
      } else {
        // Double-click (or Return) opens the agent.
        Table(rows, selection: $selection) {
          TableColumn("Agent") { row in
            // A click opens the agent, as a row click does in the desktop app.
            Button { openAgent(row) } label: {
              HStack(spacing: 8) {
                StatusDot(
                  tone: row.agent.awaiting != nil ? .warning : row.agent.status.tone,
                  pulse: row.agent.status == .running)
                Text(Labels.agentName(row.agent)).lineLimit(1)
                Text(row.agent.agentId.prefix(8)).foregroundStyle(.tertiary).font(.scaled(.caption).monospaced())
              }
              .contentShape(.rect)
            }
            .buttonStyle(.argusPlain)
          }
          .width(min: 140)
          TableColumn("Status") { row in
            Text(Labels.awaitingLabel(row.agent) ?? Labels.statusLabel(row.agent.status))
              .foregroundStyle(.secondary)
          }
          .width(min: 60, ideal: 80)
          TableColumn("Branch") { row in
            Text(row.session?.branch ?? "").foregroundStyle(.secondary).lineLimit(1)
          }
          .width(min: 70)
          TableColumn("Session") { row in
            if let session = row.session {
              Button { open(session: session) } label: {
                Text(session.displayName ?? session.branch).lineLimit(1)
              }
              .buttonStyle(.accentLink)
            } else {
              Text(row.agent.sessionLabel ?? "").foregroundStyle(.secondary)
            }
          }
          .width(min: 70)
          TableColumn("Project") { row in
            if let session = row.session {
              Button { openProject(session.repoRoot) } label: {
                Text(projectName(session.repoRoot)).lineLimit(1)
              }
              .buttonStyle(.accentLink)
            } else {
              Text(row.agent.projectName ?? "").foregroundStyle(.secondary)
            }
          }
          .width(min: 70)
        }
        .contextMenu(forSelectionType: String.self) { _ in
        } primaryAction: { ids in
          guard let id = ids.first, let row = rows.first(where: { $0.id == id }) else { return }
          openAgent(row)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .navigationTitle("Agents")
    .task { await store.loadRecentAgents() }
  }

  private func projectName(_ repoRoot: String) -> String {
    store.projects.first { $0.repoRoot == repoRoot }?.name
      ?? URL(fileURLWithPath: repoRoot).lastPathComponent
  }

  private func openAgent(_ row: Row) {
    model.navigate(.session(id: row.agent.sessionId, agentId: row.agent.agentId))
  }

  private func open(session: RemoteSession) {
    model.openAgents(session: session.id)
  }

  /// A project opens on its project-root session's agents.
  private func openProject(_ repoRoot: String) {
    guard let root = store.sessionsByRepo[repoRoot]?.first(where: { $0.kind == .projectRoot })
    else { return }
    model.openAgents(session: root.id)
  }
}

/// Title plus the counts line, as the desktop app's overview screens have.
struct OverviewHeader: View {
  let title: String
  let summary: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text(title).font(.scaled(.title2).weight(.semibold))
      Text(summary).foregroundStyle(.secondary)
      Spacer()
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 14)
  }
}
