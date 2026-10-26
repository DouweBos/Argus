import ArgusCore
import ArgusUI
import SwiftUI

/// Projects and their sessions, live from every attached host.
struct SidebarView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(RemoteHostsStore.self) private var hosts
  @State private var collapse = SidebarCollapse()

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
        SidebarLabel("Usage", systemImage: Icon.usage).tag(Self.usageTag)
      }
      if projects.isEmpty, store.projectsLoaded {
        Text("No projects yet").foregroundStyle(.secondary)
      }
      ForEach(projects) { project in
        ProjectSidebarSection(project: project, showsHost: showsHosts, collapsed: collapse.binding(project.repoRoot))
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
  private static let usageTag = "nav:usage"

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
        case .usage: Self.usageTag
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
        case Self.usageTag?: model.navigate(.usage)
        case let id?:
          // A session on an unplugged drive has nothing to open.
          let session = store.sessionsByRepo.values.joined().first { $0.id == id }
          if session?.isUnavailable != true { model.open(session: id) }
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
