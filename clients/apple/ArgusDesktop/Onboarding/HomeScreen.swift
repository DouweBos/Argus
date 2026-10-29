import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// `/`: the project picker — plan limits at a glance, what needs fixing,
/// your projects and the latest automation runs.
struct HomeScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme

  private var isEmpty: Bool { store.projectsLoaded && store.projects.isEmpty }

  var body: some View {
    Group {
      // A scroll view only offers its content's own height; with nothing to
      // list, the empty state needs the whole screen to centre in.
      if isEmpty {
        column.frame(maxHeight: .infinity)
      } else {
        ScrollView { column }
      }
    }
    .background(theme.bg)
    .navigationTitle("Home")
    .liveRefresh(enabled: store.connection == .ready, every: .seconds(60)) {
      await store.loadUsageLimits()
    }
  }

  private var column: some View {
    VStack(alignment: .leading, spacing: 24) {
      SetupCards()
      HomeEnvironmentCards()
      if !store.projectsLoaded {
        ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
      } else if store.projects.isEmpty {
        empty
      } else {
        HStack(spacing: 10) {
          Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 32, height: 32)
          Text("Argus").font(.scaled(size: 24, weight: .semibold))
        }
        if !UsageLimitsStrip.accounts(store.usageLimits).isEmpty {
          section("Plan limits") {
            Button("View usage") {
              MacTelemetry.capture(.homeUsageOpened(level: usageLevel))
              model.navigate(.usage(.limits))
            }
            .buttonStyle(.accentLink)
          } content: {
            UsageLimitsStrip(limits: store.usageLimits)
          }
        }
        HomeNeedsYouSection()
        section("Projects") {
          HStack(spacing: 12) {
            Button("Import from Claude Code…") { model.importingCliProjects = true }.buttonStyle(.accentLink)
            Button("Add Project…") { model.addingProject = true }.buttonStyle(.accentLink)
          }
        } content: {
          LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
            ForEach(projects) { HomeProjectCard(project: $0) }
          }
        }
        HomeRecentRunsSection()
      }
    }
    .padding(28)
    .frame(maxWidth: 960, alignment: .leading)
    .frame(maxWidth: .infinity)
  }

  /// The most severe plan limit on the strip, for telemetry.
  private var usageLevel: String {
    let used = (store.usageLimits?.accounts ?? []).flatMap(\.windows).map(\.usedPercent).max() ?? 0
    return switch UsageLimitFormat.level(usedPercent: used) {
    case .normal: "normal"
    case .warning: "warning"
    case .critical: "critical"
    }
  }

  /// Most recently opened first (in either desktop app), then the newest
  /// agent in each project.
  private var projects: [RemoteProject] {
    let recents = HomeRecents.shared
    func opened(_ project: RemoteProject) -> Double { recents.lastOpened(project.repoRoot) ?? 0 }
    func latest(_ project: RemoteProject) -> Double {
      (store.agentsByRepo[project.repoRoot] ?? []).map { $0.createdAt ?? 0 }.max() ?? 0
    }
    return store.projects.filter { !recents.hidden.contains($0.repoRoot) }.enumerated()
      .sorted { a, b in
        if opened(a.element) != opened(b.element) { return opened(a.element) > opened(b.element) }
        if latest(a.element) != latest(b.element) { return latest(a.element) > latest(b.element) }
        return a.offset < b.offset
      }
      .map(\.element)
  }

  private var empty: some View {
    EmptyState(
      icon: "folder.badge.plus", title: "No projects yet",
      body: "Add a git repository to start sessions and agents in it."
    ) {
      // Actions sit in a row on macOS; the shortcuts go under the button.
      VStack(spacing: 14) {
        Button {
          model.addingProject = true
        } label: {
          Label("Add repository", systemImage: "folder")
        }
        .buttonStyle(.borderedProminent)
        Button {
          model.importingCliProjects = true
        } label: {
          Label("Import from Claude Code", systemImage: "square.and.arrow.down")
        }
        VStack(alignment: .leading, spacing: 6) {
          shortcut("⌘O", "Add project")
          shortcut("⌘N", "New session")
          shortcut("⇧⌘P", "Command palette")
        }
      }
    }
  }

  private func shortcut(_ keys: String, _ label: String) -> some View {
    HStack(spacing: 8) {
      KeyHint(keys)
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
        .buttonStyle(.argusBorderless)
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
    .clickable()
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
