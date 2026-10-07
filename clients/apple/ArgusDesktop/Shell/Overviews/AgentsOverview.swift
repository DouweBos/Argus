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
    // Live status over the listed one, so a running agent reads as running.
    return store.recentAgents
      .map { store.statusByAgent[$0.agentId] ?? $0 }
      .sorted {
        let (left, right) = (Labels.activityRank($0), Labels.activityRank($1))
        return left != right ? left < right : Labels.lastActivity($0) > Labels.lastActivity($1)
      }
      .map { Row(agent: $0, session: sessions[$0.sessionId]) }
  }

  var body: some View {
    let rows = rows
    VStack(alignment: .leading, spacing: 0) {
      OverviewHeader(title: "Agents", summary: AgentsOverviewList.summary(rows.map(\.agent)))
      if rows.isEmpty {
        ContentUnavailableView(
          "No agents", systemImage: "sparkles",
          description: Text("No agents running. Start one from a session to see it here."))
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
            .buttonStyle(.plain)
          }
          .width(min: 140)
          TableColumn("Status") { row in
            Text(Labels.awaitingLabel(row.agent) ?? statusLabel(row.agent.status))
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

  private func statusLabel(_ status: RemoteAgentState) -> String {
    switch status {
    case .running: "running"
    case .error: "error"
    case .stopped: "stopped"
    case .requiresAction: "needs input"
    case .idle: "idle"
    }
  }

  private func projectName(_ repoRoot: String) -> String {
    store.projects.first { $0.repoRoot == repoRoot }?.name
      ?? URL(fileURLWithPath: repoRoot).lastPathComponent
  }

  private func openAgent(_ row: Row) {
    model.navigate(.session(id: row.agent.sessionId, agentId: row.agent.agentId))
  }

  private func open(session: RemoteSession) {
    model.navigate(.sessionHome(id: session.id))
  }

  /// A project opens on its project-root session's home, as in the desktop app.
  private func openProject(_ repoRoot: String) {
    guard let root = store.sessionsByRepo[repoRoot]?.first(where: { $0.kind == .projectRoot })
    else { return }
    model.navigate(.sessionHome(id: root.id))
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
