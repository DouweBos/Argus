import ArgusUI
import SwiftUI

/// The iPad sidebar, flat like the Mac's: the sections, then every project's
/// sessions as one row each. A session's agents are tabs on its own screen.
struct SessionSidebar: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(ProposalsStore.self) private var proposals
  @Environment(AutomationsStore.self) private var automations
  @State private var unfolded: Set<String> = []
  @State private var snoozing: RemoteSession?

  var body: some View {
    List(selection: selection) {
      if !app.hosts.isEmpty {
        Section { ComputerSwitcher() }
      }
      Section {
        ForEach(AppSection.primary.filter { $0 != .issues || host.linearConnected }) { sectionRow($0) }
      }
      Section {
        ForEach(AppSection.secondary) { sectionRow($0) }
      }

      let needsYou = host.projects.map { project in
        (project, SessionGroupTriage(host.sessionGroups(repoRoot: project.repoRoot)).needsYou)
      }.filter { !$0.1.isEmpty }
      if !needsYou.isEmpty {
        Section("Needs you") {
          ForEach(needsYou, id: \.0.repoRoot) { project, groups in
            items(groups, in: project, caption: project.name)
          }
        }
      }

      ForEach(host.projects) { project in
        Section(isExpanded: expansion(project)) {
          let groups = host.sessionGroups(repoRoot: project.repoRoot)
          let triage = SessionGroupTriage(groups)
          if groups.isEmpty {
            Text("No sessions").font(.scaled(.footnote)).foregroundStyle(theme.textSecondary)
          }
          items(triage.active, in: project)
          if !triage.folded.isEmpty {
            foldToggle(project, triage: triage)
            if unfolded.contains(project.repoRoot) {
              items(triage.folded, in: project)
            }
          }
        } header: {
          header(project)
        }
      }
    }
    .sheet(item: $snoozing) { session in
      NavigationStack { SnoozeUntilForm(session: session) }
    }
    .listStyle(.sidebar)
    // The selection fill is the tint, under white labels: never the near-white muted accent.
    .tint(theme.tint)
    // `recentAgents` spans every project, so only the sessions cost a fetch.
    .task(id: host.projects.map(\.repoRoot)) {
      for project in host.projects { await host.loadSessions(repoRoot: project.repoRoot) }
    }
  }

  private func sectionRow(_ section: AppSection) -> some View {
    Label(section.title, systemImage: section.symbol)
      .badge(badge(for: section))
      .tag(SidebarItem.section(section))
  }

  private func badge(for section: AppSection) -> Int {
    switch section {
    case .inbox: proposals.items(runs: automations.runs, sessionIds: []).actionCount
    case .notifications: app.notifications.unseenCount
    default: 0
    }
  }

  /// Session rows, a compare run's slots under its header; they share a section since a run sorts as one.
  @ViewBuilder
  private func items(_ groups: [SessionGroup], in project: RemoteProject, caption: String? = nil) -> some View {
    ForEach(CompareSessionRow.make(groups)) { item in
      switch item {
      case .session(let group):
        sessionItem(group, in: project, caption: caption)
      case .compare(let run, let slots):
        // Not a selection: the sidebar selects sessions, so the run opens in the detail column.
        Button {
          router.open(.compareRun(groupId: run.id), in: .home)
        } label: {
          CompareRunHeaderRow(run: run, selected: router.detailStack.last == .compareRun(groupId: run.id))
        }
        .buttonStyle(.argusPlain)
        ForEach(slots) { sessionItem($0, in: project, caption: caption, slot: true) }
      }
    }
  }

  private func sessionItem(
    _ group: SessionGroup, in project: RemoteProject, caption: String? = nil, slot: Bool = false
  ) -> some View {
    row(group, caption: caption, slot: slot)
      .padding(.leading, slot ? 14 : 0)
      .tag(
        SidebarItem.session(
          id: group.id, label: group.label, repoRoot: project.repoRoot, projectName: project.name))
      .contextMenu {
        if let session = group.session {
          PullRequestWatchButton(session: session)
          SessionTriageMenu(session: session) { snoozing = session }
        }
      }
  }

  /// "2 done · 1 snoozed", opening the project's folded sessions underneath.
  private func foldToggle(_ project: RemoteProject, triage: SessionGroupTriage) -> some View {
    let open = unfolded.contains(project.repoRoot)
    return Button {
      if open { unfolded.remove(project.repoRoot) } else { unfolded.insert(project.repoRoot) }
      Telemetry.capture(.sessionsFoldToggled(expanded: !open, done: triage.done.count, snoozed: triage.snoozed.count))
    } label: {
      Label(triage.foldedLabel, systemImage: open ? Icon.chevronDown : Icon.chevronRight)
        .font(.scaled(.footnote))
        .foregroundStyle(theme.textSecondary)
    }
    .accessibilityValue(open ? "Expanded" : "Collapsed")
  }

  @ViewBuilder
  private func row(_ group: SessionGroup, caption: String? = nil, slot: Bool = false) -> some View {
    if let session = group.session {
      SessionRow(
        session: session, agents: group.agents,
        selected: router.sidebarSelection == .session(id: group.id, label: "", repoRoot: "", projectName: ""),
        caption: caption, title: slot ? session.compareGroup.map(host.compareSlotTitle) : nil)
    } else {
      // Known only from its agents until the project's sessions load.
      Text(group.label).lineLimit(1).padding(.leading, 18)
    }
  }

  /// The project's badge and name, with a `+` for a new session as on the Mac's project header.
  private func header(_ project: RemoteProject) -> some View {
    HStack(spacing: 6) {
      ProjectBadge(project.name, key: project.repoRoot)
      Text(project.name).lineLimit(1)
      Spacer(minLength: 4)
      if host.hasControl {
        Button {
          router.push(.newSession(repoRoot: project.repoRoot))
          Telemetry.capture(.newSessionOpened(source: .sidebar))
        } label: {
          Label("New session in \(project.name)", systemImage: Icon.plus).labelStyle(.iconOnly)
        }
        .buttonStyle(.borderless)
      }
    }
  }

  private var selection: Binding<SidebarItem?> {
    Binding(
      get: { router.sidebarSelection },
      set: { router.apply($0) })
  }

  private func expansion(_ project: RemoteProject) -> Binding<Bool> {
    Binding(
      get: { !router.collapsedProjects.contains(project.repoRoot) },
      set: { open in
        if open {
          router.collapsedProjects.remove(project.repoRoot)
          Task { await host.loadSessions(repoRoot: project.repoRoot) }
        } else {
          router.collapsedProjects.insert(project.repoRoot)
        }
      })
  }
}
