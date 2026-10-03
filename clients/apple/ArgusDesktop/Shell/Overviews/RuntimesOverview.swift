import ArgusCore
import ArgusUI
import SwiftUI

/// `/runtimes`: every run command's terminal, across sessions and projects.
struct RuntimesOverview: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(TerminalsStore.self) private var terminals
  @State private var selection: Set<String> = []

  struct Row: Identifiable {
    let tab: TerminalsStore.Tab
    let session: RemoteSession
    var id: String { tab.id }
  }

  private var sessions: [RemoteSession] { Array(store.sessionsByRepo.values.joined()) }

  private var rows: [Row] {
    let byId = Dictionary(sessions.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    return terminals.tabsBySession.values.joined()
      .filter(\.isRun)
      .compactMap { tab in byId[tab.sessionId].map { Row(tab: tab, session: $0) } }
      .sorted { ($0.tab.exited ? 1 : 0, $0.tab.title) < ($1.tab.exited ? 1 : 0, $1.tab.title) }
  }

  var body: some View {
    let rows = rows
    let running = rows.filter { !$0.tab.exited }.count
    VStack(alignment: .leading, spacing: 0) {
      OverviewHeader(
        title: "Runtimes",
        summary: "\(rows.count) total · \(running) running · \(rows.count - running) stopped")
      if rows.isEmpty {
        ContentUnavailableView(
          "No runtimes", systemImage: "play.rectangle",
          description: Text("No dev servers running. Start one from a session to see it here."))
      } else {
        Table(rows, selection: $selection) {
          TableColumn("Process") { row in
            Button { show(row) } label: {
              HStack(spacing: 8) {
                StatusDot(tone: row.tab.exited ? .muted : .accent, pulse: !row.tab.exited)
                Text(row.tab.title)
              }
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
          }
          TableColumn("Status") { row in
            Text(row.tab.exited ? "stopped" : "running").foregroundStyle(.secondary)
          }
          .width(min: 70, ideal: 90)
          TableColumn("Session") { row in
            Button { model.open(session: row.session.id) } label: {
              Text(sessionLabel(row.session)).lineLimit(1)
            }
              .buttonStyle(.link)
          }
          TableColumn("Project") { row in
            Button { openProject(row.session.repoRoot) } label: {
              Text(projectName(row.session.repoRoot)).lineLimit(1)
            }
              .buttonStyle(.link)
          }
          TableColumn("") { row in
            if !row.tab.exited {
              Button {
                MacTelemetry.capture(.terminalUsed(action: .stop))
                Task { await terminals.stop(row.tab.id) }
              } label: {
                Image(systemName: "stop.fill")
              }
              .buttonStyle(.borderless)
              .help("Stop process")
            }
          }
          .width(28)
        }
        .contextMenu(forSelectionType: String.self) { _ in
        } primaryAction: { ids in
          guard let id = ids.first, let row = rows.first(where: { $0.id == id }) else { return }
          show(row)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .navigationTitle("Runtimes")
    // A run started before this window opened lives only on the host.
    .task(id: sessions.map(\.id)) {
      for session in sessions where session.status == .ready {
        await terminals.refresh(sessionId: session.id)
      }
    }
  }

  /// The run's own tab, in its session's terminal panel.
  private func show(_ row: Row) {
    terminals.select(row.tab.id, in: row.session.id)
    model.terminalPanelVisible = true
    model.open(session: row.session.id)
  }

  private func sessionLabel(_ session: RemoteSession) -> String {
    session.kind == .projectRoot ? "project root" : (session.displayName ?? session.branch)
  }

  private func projectName(_ repoRoot: String) -> String {
    store.projects.first { $0.repoRoot == repoRoot }?.name
      ?? URL(fileURLWithPath: repoRoot).lastPathComponent
  }

  private func openProject(_ repoRoot: String) {
    guard let root = store.sessionsByRepo[repoRoot]?.first(where: { $0.kind == .projectRoot })
    else { return }
    model.navigate(.sessionHome(id: root.id))
  }
}
