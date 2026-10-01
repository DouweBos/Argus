import ArgusUI
import SwiftUI

/// Projects and their sessions, live from the host.
struct SidebarView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var deleting: RemoteSession?

  var body: some View {
    List(selection: selection) {
      if store.projects.isEmpty {
        Text("No projects yet").foregroundStyle(.secondary)
      }
      ForEach(store.projects) { project in
        Section {
          ForEach(store.sessionsByRepo[project.repoRoot] ?? []) { session in
            SessionRow(session: session, agents: agents(in: session))
              .tag(session.id)
              .contextMenu {
                if session.kind == .worktree {
                  Button("Delete Session…") { deleting = session }
                }
              }
          }
        } header: {
          HStack {
            Text(project.name)
            Spacer()
            Button {
              model.newSessionProject = project
            } label: {
              Image(systemName: "plus")
            }
            .buttonStyle(.borderless)
            .help("New session in \(project.name)")
          }
        }
      }
      if !store.scratchPads.isEmpty {
        Section("Scratch pads") {
          ForEach(store.scratchPads) { pad in
            SessionRow(session: pad, agents: agents(in: pad)).tag(pad.id)
          }
        }
      }
    }
    .listStyle(.sidebar)
    .sheet(item: newSessionProject) { project in
      NewSessionSheet(project: project) { session in
        model.navigate(.session(id: session.id, agentId: nil))
      }
    }
    .sheet(item: $deleting) { session in
      DeleteSessionSheet(session: session) {
        if model.route.sessionId == session.id { model.navigate(.home) }
      }
    }
    .overlay(alignment: .bottom) {
      if store.connection != .ready {
        ConnectionBadge(state: store.connection).padding(8)
      }
    }
  }

  private var newSessionProject: Binding<RemoteProject?> {
    Binding(get: { model.newSessionProject }, set: { model.newSessionProject = $0 })
  }

  private var selection: Binding<String?> {
    Binding(
      get: { model.route.sessionId },
      set: { id in
        if let id { model.navigate(.session(id: id, agentId: nil)) }
      })
  }

  private func agents(in session: RemoteSession) -> [RemoteAgentStatus] {
    (store.agentsByRepo[session.repoRoot] ?? []).filter { $0.sessionId == session.id }
  }
}

struct SessionRow: View {
  let session: RemoteSession
  let agents: [RemoteAgentStatus]

  var body: some View {
    HStack(spacing: 8) {
      StatusDot(tone: tone, pulse: isBusy)
      VStack(alignment: .leading, spacing: 2) {
        Text(session.displayName ?? session.branch).lineLimit(1)
        if let subtitle {
          Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
      }
      Spacer(minLength: 4)
      if let fraction = session.progress?.fraction, session.status != .ready {
        ProgressView(value: fraction).progressViewStyle(.circular).controlSize(.mini)
      }
    }
  }

  private var isBusy: Bool {
    session.status == .initializing || agents.contains { $0.status == .running }
  }

  private var tone: Tone {
    switch session.status {
    case .error: .danger
    case .initializing, .deleting: .muted
    case .ready:
      agents.contains { $0.awaiting != nil } ? .warning : (isBusy ? .accent : .muted)
    }
  }

  private var subtitle: String? {
    switch session.status {
    case .initializing: "Setting up…"
    case .deleting: "Deleting…"
    case .error: session.setupError ?? "Setup failed"
    case .ready:
      agents.isEmpty ? (session.displayName == nil ? nil : session.branch)
        : "\(agents.count) agent\(agents.count == 1 ? "" : "s")"
    }
  }
}
