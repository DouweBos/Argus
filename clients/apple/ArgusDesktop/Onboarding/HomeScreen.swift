import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// `/`: the project picker — what needs fixing, your projects, the agents at
/// work and the devices that are up.
struct HomeScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        SetupCards()
        HomeEnvironmentCards()
        if store.projects.isEmpty {
          empty
        } else {
          HStack(spacing: 10) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 32, height: 32)
            Text("Argus").font(.scaled(size: 24, weight: .semibold))
          }
          HomeNeedsYouSection()
          section("Projects") {
            Button("Add Project…") { model.addingProject = true }.buttonStyle(.accentLink)
          } content: {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
              ForEach(projects) { HomeProjectCard(project: $0) }
            }
          }
          HStack(alignment: .top, spacing: 20) {
            section("Active agents") {
              Button("View all") { model.navigate(.agents) }.buttonStyle(.accentLink)
            } content: {
              HomeAgentsList()
            }
            section("Devices") {
              Button("View all") { model.navigate(.devices) }.buttonStyle(.accentLink)
            } content: {
              HomeDevicesList()
            }
          }
          HomeRecentRunsSection()
        }
      }
      .padding(28)
      .frame(maxWidth: 960, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .background(theme.bg)
    .navigationTitle("Home")
    .task {
      await store.refreshDevices()
      // Every 5 s while the screen is up, as the desktop polls.
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(5))
        await store.refreshDevices()
      }
    }
  }

  /// Most recently active first: the newest agent in each project.
  private var projects: [RemoteProject] {
    func latest(_ project: RemoteProject) -> Double {
      (store.agentsByRepo[project.repoRoot] ?? []).map { $0.createdAt ?? 0 }.max() ?? 0
    }
    return store.projects.filter { !HomeRecents.shared.hidden.contains($0.repoRoot) }.enumerated()
      .sorted { latest($0.element) != latest($1.element) ? latest($0.element) > latest($1.element) : $0.offset < $1.offset }
      .map(\.element)
  }

  private var empty: some View {
    VStack(spacing: 14) {
      Image(systemName: "folder.badge.plus").font(.scaled(size: 40)).foregroundStyle(theme.textMuted)
      Text("No projects yet").font(.scaled(.title2).weight(.semibold))
      Text("Add a git repository to start sessions and agents in it.").foregroundStyle(theme.textSecondary)
      Button {
        model.addingProject = true
      } label: {
        Label("Add repository", systemImage: "folder")
      }
      .buttonStyle(.borderedProminent)
      VStack(alignment: .leading, spacing: 6) {
        shortcut("⌘O", "Add project")
        shortcut("⌘N", "New session")
        shortcut("⇧⌘P", "Command palette")
      }
      .padding(.top, 6)
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 60)
  }

  private func shortcut(_ keys: String, _ label: String) -> some View {
    HStack(spacing: 8) {
      Text(keys).font(.scaled(size: 11, design: .monospaced))
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(theme.bgTertiary)
        .clipShape(RoundedRectangle(cornerRadius: 4))
      Text(label).font(.scaled(size: 11)).foregroundStyle(theme.textMuted)
    }
  }

  private func section<Trailing: View, Content: View>(
    _ title: String, @ViewBuilder trailing: () -> Trailing, @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(title.uppercased()).font(.scaled(size: 11, weight: .semibold)).foregroundStyle(theme.textMuted)
        Spacer()
        trailing()
      }
      content()
    }
    .frame(maxWidth: .infinity, alignment: .topLeading)
  }
}

private struct HomeProjectCard: View {
  let project: RemoteProject
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  @State private var hovering = false

  var body: some View {
    let agents = store.agentsByRepo[project.repoRoot] ?? []
    let sessions = (store.sessionsByRepo[project.repoRoot] ?? []).filter { $0.kind == .worktree }
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Image(systemName: "folder.fill").foregroundStyle(theme.accent)
        Text(project.name).font(.scaled(size: 14, weight: .semibold)).lineLimit(1)
        if model.host(ofProject: project.repoRoot) != Hosts.local { HostBadge(hostId: model.host(ofProject: project.repoRoot)) }
        Spacer()
        Button {
          model.newSessionProject = project
        } label: {
          Image(systemName: "plus")
        }
        .buttonStyle(.borderless)
        .help("New session in \(project.name)")
      }
      Text(HostScopedPath.path(project.repoRoot)).font(.scaled(.caption)).foregroundStyle(theme.textMuted).lineLimit(1).truncationMode(.middle)
      HStack(spacing: 6) {
        ForEach(agents.prefix(8)) { StatusDot(tone: tone($0.status), pulse: $0.status == .running) }
        Text(summary(agents: agents.count, sessions: sessions.count))
          .font(.scaled(.caption)).foregroundStyle(theme.textSecondary)
        Spacer()
        if let last = agents.map(Labels.lastActivity).max(), last > 0 {
          Text(Labels.timeAgo(last)).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
        }
      }
    }
    .padding(12)
    .background(hovering ? theme.bgHover : theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radius))
    .overlay(RoundedRectangle(cornerRadius: theme.radius).stroke(theme.borderSubtle))
    .contentShape(Rectangle())
    .onHover { hovering = $0 }
    .onTapGesture { Task { await model.openProjectRoot(project.repoRoot) } }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Project \(project.name)")
    .accessibilityAddTraits(.isButton)
    .contextMenu {
      Button("Open") { Task { await model.openProjectRoot(project.repoRoot) } }
      Button("New Session…") { model.newSessionProject = project }
      Button("Project Settings…") { model.projectSettingsRepo = project.repoRoot }
      Button("Remove from Recents") { HomeRecents.shared.hide(project.repoRoot) }
      // Another host's folder isn't on this Mac's disk.
      if HostScopedPath.split(project.repoRoot) == nil {
        Divider()
        Button("Reveal in Finder") {
          NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: project.repoRoot)])
        }
      }
    }
  }

  private func summary(agents: Int, sessions: Int) -> String {
    let s = "\(sessions) session\(sessions == 1 ? "" : "s")"
    return agents == 0 ? s : "\(s) · \(agents) agent\(agents == 1 ? "" : "s")"
  }

  private func tone(_ status: RemoteAgentState) -> Tone {
    switch status {
    case .running: .accent
    case .error: .danger
    case .requiresAction: .warning
    case .stopped: .success
    case .idle: .muted
    }
  }
}

private struct HomeAgentsList: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme

  var body: some View {
    let agents = store.recentAgents.map { store.statusByAgent[$0.agentId] ?? $0 }
      .filter { $0.status != .stopped }
      .sorted { Labels.activityRank($0) < Labels.activityRank($1) }
    if agents.isEmpty {
      Text("No agents running. Start one from a session.").foregroundStyle(theme.textMuted).font(.scaled(.callout))
    } else {
      VStack(alignment: .leading, spacing: 2) {
        ForEach(agents.prefix(6)) { agent in
          Button {
            model.navigate(.session(id: agent.sessionId, agentId: agent.agentId))
          } label: {
            HStack(spacing: 8) {
              StatusDot(tone: agent.status == .running ? .accent : .muted, pulse: agent.status == .running)
              Text(Labels.agentName(agent)).lineLimit(1)
              Spacer()
              Text(agent.projectName ?? "").font(.scaled(.caption)).foregroundStyle(theme.textMuted)
              Text(Labels.metaLabel(agent.status)).font(.scaled(.caption)).foregroundStyle(theme.textSecondary)
            }
            .padding(.vertical, 5)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
    }
  }
}

private struct HomeDevicesList: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme

  var body: some View {
    let devices = store.devices.filter(\.booted)
    if devices.isEmpty {
      Text("No devices online. Boot a simulator or start an agent.").foregroundStyle(theme.textMuted).font(.scaled(.callout))
    } else {
      VStack(alignment: .leading, spacing: 2) {
        ForEach(devices.prefix(6), id: \.id) { device in
          Button {
            model.navigate(.devices)
          } label: {
            HStack(spacing: 8) {
              StatusDot(tone: .success)
              Text(device.name).lineLimit(1)
              Spacer()
              Text(device.platform.rawValue.uppercased()).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
            }
            .padding(.vertical, 5)
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
    }
  }
}
