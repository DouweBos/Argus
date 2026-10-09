import ArgusCore
import ArgusUI
import SwiftUI

/// Projects and their sessions, live from every attached host.
struct SidebarView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(RemoteHostsStore.self) private var hosts

  var body: some View {
    // The footer sits under the list, not in its safe area: a sidebar List
    // scrolls its rows beneath a bottom inset, so the last ones were covered.
    VStack(spacing: 0) {
      projectList
      addRepositoryFooter
    }
    .sheet(item: newSessionProject) { project in
      NewSessionSheet(project: project) { session in
        model.navigate(.sessionHome(id: session.id))
      }
    }
    .sheet(item: deletingSession) { session in
      DeleteSessionSheet(session: session) {
        if model.route.sessionId == session.id { model.navigate(.home) }
      }
    }
  }

  private var projectList: some View {
    List(selection: selection) {
      Section {
        SidebarLabel("Home", systemImage: "house").tag(Self.homeTag).help("App home (⇧⌘H)")
        SidebarLabel("Agents", systemImage: "sparkles").tag(Self.agentsTag)
        SidebarLabel("Runtimes", systemImage: "play.rectangle").tag(Self.runtimesTag)
        SidebarLabel("Devices", systemImage: "iphone.gen3").tag(Self.devicesTag)
        SidebarLabel("Pull Requests", systemImage: "arrow.triangle.pull").tag(Self.pullRequestsTag)
      }
      Section {
        SidebarLabel("Inbox", systemImage: "tray").tag(Self.inboxTag)
        SidebarLabel("Automations", systemImage: "clock.arrow.circlepath").tag(Self.automationsTag)
        NotificationsSidebarRow().tag(Self.notificationsTag)
      }
      if projects.isEmpty, store.projectsLoaded {
        Text("No projects yet").foregroundStyle(.secondary)
      }
      ForEach(projects) { project in
        Section {
          ForEach(store.sessionsByRepo[project.repoRoot] ?? []) { session in
            SessionRow(session: session, agents: agents(in: session))
              .tag(session.id)
              .contextMenu {
                Button("Open in New Tab") {
                  model.openTab(DesktopLocation(route: .sessionHome(id: session.id), host: model.host(ofSession: session.id)))
                }
                if session.kind == .worktree {
                  Button("Delete Session…") { model.deletingSession = session }
                }
              }
          }
        } header: {
          HStack {
            Text(project.name).font(.sidebarScaled(.subheadline))
            if showsHosts { HostBadge(hostId: model.host(ofProject: project.repoRoot)) }
            Spacer()
            Button {
              model.newSessionProject = project
            } label: {
              Image(systemName: "plus")
            }
            .buttonStyle(.borderless)
            .help("New session in \(project.name)")
          }
          .contextMenu {
            Button("New Session…") { model.newSessionProject = project }
            Button("Project Settings…") { model.projectSettingsRepo = project.repoRoot }
          }
        }
      }
      Section {
        ForEach(scratchPads) { pad in
          SessionRow(session: pad, agents: agents(in: pad)).tag(pad.id)
            .contextMenu {
              Button("Open in New Tab") {
                model.openTab(DesktopLocation(route: .sessionHome(id: pad.id), host: model.host(ofSession: pad.id)))
              }
              Button("Delete Scratch Pad…") { model.deletingSession = pad }
            }
        }
      } header: {
        HStack {
          Text("Scratch pads").font(.sidebarScaled(.subheadline))
          Spacer()
          Button {
            Task { await model.newScratchPad() }
          } label: {
            Image(systemName: "plus")
          }
          .buttonStyle(.borderless)
          .help("New scratch pad")
          .accessibilityLabel("New scratch pad")
        }
      }
    }
    .listStyle(.sidebar)
    .safeAreaInset(edge: .top) {
      if showsHosts { MachinesMenu().padding(.horizontal, 10).padding(.top, 4) }
    }
  }

  private var addRepositoryFooter: some View {
    VStack(spacing: 0) {
      if store.connection != .ready {
        ConnectionBadge(state: store.connection).padding(8)
      }
      Divider()
      Button {
        model.addingProject = true
      } label: {
        Label("Add repository", systemImage: "plus")
          .font(.sidebarScaled(.body))
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(Rectangle())
      }
      .buttonStyle(.borderless)
      .foregroundStyle(.secondary)
      .help("Add a git repository (⌘O)")
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
    }
  }

  private var deletingSession: Binding<RemoteSession?> {
    Binding(get: { model.deletingSession }, set: { model.deletingSession = $0 })
  }

  private var newSessionProject: Binding<RemoteProject?> {
    Binding(get: { model.newSessionProject }, set: { model.newSessionProject = $0 })
  }

  private static let homeTag = "nav:home"
  private static let agentsTag = "nav:agents"
  private static let runtimesTag = "nav:runtimes"
  private static let devicesTag = "nav:devices"
  private static let pullRequestsTag = "nav:pull-requests"
  private static let inboxTag = "nav:inbox"
  private static let automationsTag = "nav:automations"
  private static let notificationsTag = "nav:notifications"

  private var selection: Binding<String?> {
    Binding(
      get: {
        switch model.route {
        case .home: Self.homeTag
        case .agents: Self.agentsTag
        case .runtimes: Self.runtimesTag
        case .devices, .device: Self.devicesTag
        case .pullRequests, .pullRequest: Self.pullRequestsTag
        case .inbox, .proposal: Self.inboxTag
        case .automations, .automation, .quickRun: Self.automationsTag
        case .notifications: Self.notificationsTag
        default: model.route.sessionId
        }
      },
      set: { tag in
        switch tag {
        case Self.homeTag?: model.navigate(.home)
        case Self.agentsTag?: model.navigate(.agents)
        case Self.runtimesTag?: model.navigate(.runtimes)
        case Self.devicesTag?: model.navigate(.devices)
        case Self.pullRequestsTag?: model.navigate(.pullRequests)
        case Self.inboxTag?: model.navigate(.inbox)
        case Self.automationsTag?: model.navigate(.automations)
        case Self.notificationsTag?: model.navigate(.notifications)
        case let id?: model.open(session: id)
        case nil: break
        }
      })
  }

  /// Hosts are only worth naming once there is more than this Mac.
  private var showsHosts: Bool { !hosts.attached.isEmpty }

  /// This Mac's projects first, then each host's in pairing order, narrowed to
  /// the machine picked in the sidebar.
  private var projects: [RemoteProject] {
    let order = Dictionary(uniqueKeysWithValues: hosts.machines.enumerated().map { ($1, $0) })
    return store.projects
      .filter { model.machineFilter == nil || model.host(ofProject: $0.repoRoot) == model.machineFilter }
      .enumerated()
      .sorted { a, b in
        let ha = order[model.host(ofProject: a.element.repoRoot)] ?? .max
        let hb = order[model.host(ofProject: b.element.repoRoot)] ?? .max
        return ha == hb ? a.offset < b.offset : ha < hb
      }
      .map(\.element)
  }

  private var scratchPads: [RemoteSession] {
    store.scratchPads.filter {
      model.machineFilter == nil || model.host(ofSession: $0.id) == model.machineFilter
    }
  }

  private func agents(in session: RemoteSession) -> [RemoteAgentStatus] {
    (store.agentsByRepo[session.repoRoot] ?? []).filter { $0.sessionId == session.id }
  }
}

/// Notifications, with a count of what you haven't looked at yet.
private struct NotificationsSidebarRow: View {
  @Environment(DesktopModel.self) private var model

  var body: some View {
    SidebarLabel("Notifications", systemImage: "exclamationmark.triangle")
      .badge(model.notificationsLog.unseenCount)
  }
}

struct SessionRow: View {
  let session: RemoteSession
  let agents: [RemoteAgentStatus]

  var body: some View {
    HStack(spacing: 8) {
      StatusDot(tone: tone, pulse: isBusy)
      VStack(alignment: .leading, spacing: 2) {
        Text(session.displayName ?? session.branch).font(.sidebarScaled(.body)).lineLimit(1)
        if let subtitle {
          Text(subtitle).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
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
