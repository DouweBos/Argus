import ArgusUI
import SwiftUI

/// One project on Home, as the Mac sidebar draws it: a header that folds the card
/// shut, then its sessions, those that need you first, the done and snoozed ones folded.
struct HomeProjectSection<Header: View>: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush

  let project: RemoteProject
  let newSession: () -> Void
  let snooze: (RemoteSession) -> Void
  let remove: () -> Void
  /// The list's own header, above the first card.
  @ViewBuilder let header: Header

  private var sessions: [RemoteSession] { host.sessionsByRepo[project.repoRoot] ?? [] }
  private var collapsed: Bool { hasWorktrees && router.collapsedProjects.contains(project.repoRoot) }
  /// With nothing but its root checkout there is nothing to fold: the header is that checkout.
  private var hasWorktrees: Bool { sessions.contains { $0.kind != .projectRoot } }
  private var unfolded: Bool { router.unfoldedProjects.contains(project.repoRoot) }

  var body: some View {
    let groups = host.sessionGroups(repoRoot: project.repoRoot)
    let root = groups.first(where: \.isRoot)
    // The root lives in the header, as on the Mac, until sessions beside it and an agent in it want a row of its own.
    let rootRow = hasWorktrees && (root.map { !$0.agents.isEmpty } ?? false)
    let triage = SessionGroupTriage(groups.filter { !$0.isRoot || rootRow })
    Section {
      projectHeader(root: rootRow ? nil : root, triage: triage)
      if !collapsed {
        if !triage.needsYou.isEmpty {
          SidebarSectionHeader(title: "Needs you").listRowSeparator(.hidden)
          rows(triage.needsYou)
          // Without a rule of their own the rest read as more of what needs you.
          if !triage.active.isEmpty {
            SidebarSectionHeader(title: "Sessions").listRowSeparator(.hidden)
          }
        }
        rows(triage.active)
        if !triage.folded.isEmpty {
          Button { toggleFold(triage) } label: {
            FoldedSessionsLabel(triage.foldedLabel, expanded: unfolded).contentShape(.rect)
          }
          .buttonStyle(.argusPlain)
          .listRowSeparator(.hidden)
          if unfolded {
            rows(triage.done).opacity(0.7)
            rows(triage.snoozed)
          }
        }
      }
    } header: {
      header
    }
  }

  // MARK: - Header

  private func projectHeader(root: SessionGroup?, triage: SessionGroupTriage) -> some View {
    let rootSession = sessions.first { $0.kind == .projectRoot && !$0.isUnavailable }
    return HStack(spacing: 8) {
      if hasWorktrees { chevron } else { Color.clear.frame(width: 12, height: 32) }
      // As on the Mac, the header is the project's root checkout.
      Button {
        if let rootSession { open(rootSession) } else if hasWorktrees { toggleCollapsed() }
      } label: {
        HStack(spacing: 8) {
          ProjectBadge(project.name, key: project.repoRoot, size: 20)
          VStack(alignment: .leading, spacing: 2) {
            Text(project.name)
              .font(.scaled(.body).weight(.semibold))
              .foregroundStyle(theme.text)
              .lineLimit(1)
            if collapsed, let summary = summary(triage) {
              Text(summary.text)
                .font(.scaled(.caption))
                .foregroundStyle(summary.urgent ? theme.warning : theme.textMuted)
                .lineLimit(1)
            }
          }
          .layoutPriority(1)
          Spacer(minLength: 4)
          if let session = root?.session {
            ProjectRootState(
              activity: SessionActivity(session: session, agents: root?.agents ?? []),
              branch: host.gitStatusBySession[session.id]?.branch ?? session.branch
            )
            .font(.scaled(.caption))
          }
        }
        .contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel(project.name)
      .accessibilityHint(rootSession.map { "Opens \($0.branch)" } ?? (!hasWorktrees ? "" : collapsed ? "Shows its sessions" : "Hides its sessions"))
      if host.hasControl {
        Button(action: newSession) {
          Image(systemName: Icon.plus)
            .font(.scaled(.body).weight(.medium))
            .frame(width: 32, height: 32)
            .contentShape(.rect)
        }
        .buttonStyle(.argusPlain)
        .foregroundStyle(theme.accent)
        .padding(.vertical, -4)
        .accessibilityLabel("New session in \(project.name)")
      }
    }
    .contextMenu { projectMenu(root: sessions.first { $0.kind == .projectRoot }) }
  }

  private var chevron: some View {
    Button(action: toggleCollapsed) {
      Image(systemName: collapsed ? Icon.chevronRight : Icon.chevronDown)
        .font(.scaled(.caption).weight(.semibold))
        .foregroundStyle(theme.textMuted)
        .frame(width: 24, height: 32)
        .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .padding(.leading, -6)
    .padding(.trailing, -6)
    .accessibilityLabel(collapsed ? "Expand \(project.name)" : "Collapse \(project.name)")
  }

  @ViewBuilder
  private func projectMenu(root: RemoteSession?) -> some View {
    if host.hasControl {
      Button("New session", systemImage: Icon.plus, action: newSession)
    }
    if let root, !root.isUnavailable {
      Button("Open \(root.branch)", systemImage: Icon.branch) { open(root) }
    }
    Button("Sessions and Chats", systemImage: Icon.history) {
      followHomeLink(.project) {
        (stackPush ?? router.push)(.project(repoRoot: project.repoRoot, name: project.name))
      }
    }
    if hasWorktrees {
      Button(collapsed ? "Expand" : "Collapse", systemImage: collapsed ? Icon.chevronDown : Icon.chevronRight) {
        toggleCollapsed()
      }
    }
    if host.hasControl {
      Divider()
      Button("Remove Project", systemImage: Icon.trash, role: .destructive, action: remove)
    }
  }

  /// What a folded card still owes you: what needs you, else what's running, else how many.
  private func summary(_ triage: SessionGroupTriage) -> (text: String, urgent: Bool)? {
    if !triage.needsYou.isEmpty { return ("\(triage.needsYou.count) need\(triage.needsYou.count == 1 ? "s" : "") you", true) }
    let working = triage.active.count { group in
      group.session.map { SessionActivity(session: $0, agents: group.agents).isBusy } ?? false
    }
    if working > 0 { return ("\(working) working", false) }
    let count = sessions.count { $0.kind == .worktree }
    return count == 0 ? nil : ("\(count) session\(count == 1 ? "" : "s")", false)
  }

  // MARK: - Rows

  private func rows(_ groups: [SessionGroup]) -> some View {
    SessionGroupRows(groups, all: host.sessionsByRepo.values.flatMap { $0 }) { group, placement in
      row(group, placement)
    } header: { run in
      Button {
        (stackPush ?? router.push)(.compareRun(groupId: run.id))
      } label: {
        CompareRunHeaderRow(run: run).contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
      .listRowSeparator(.hidden)
    }
  }

  private func row(_ group: SessionGroup, _ placement: SessionRowPlacement) -> some View {
    Button {
      followHomeLink(.session) {
        (stackPush ?? router.push)(.session(id: group.id, label: group.label, repoRoot: project.repoRoot))
      }
    } label: {
      Group {
        if let session = group.session {
          SessionRow(
            session: session, agents: group.agents, caption: placement.caption,
            title: placement.slot ? session.compareGroup.map(host.compareSlotTitle) : nil,
            indent: placement.indent, stacked: placement.stacked)
        } else {
          // Known only from its agents until the project's sessions load.
          Text(group.label).foregroundStyle(theme.text).lineLimit(1).padding(.leading, 18)
        }
      }
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .disabled(group.session?.isUnavailable == true)
    .listRowSeparator(.hidden)
    .contextMenu {
      if let session = group.session {
        PullRequestWatchButton(session: session)
        SessionTriageMenu(session: session) { snooze(session) }
      }
    }
  }

  private func open(_ session: RemoteSession) {
    followHomeLink(.session) {
      (stackPush ?? router.push)(.session(id: session.id, label: session.branch, repoRoot: project.repoRoot))
    }
  }

  // MARK: - Folding

  private func toggleCollapsed() {
    let collapse = !collapsed
    withAnimation(.snappy) {
      if collapse {
        router.collapsedProjects.insert(project.repoRoot)
      } else {
        router.collapsedProjects.remove(project.repoRoot)
      }
    }
    Telemetry.capture(.projectCollapseToggled(collapsed: collapse, source: .home))
  }

  private func toggleFold(_ triage: SessionGroupTriage) {
    let expand = !unfolded
    withAnimation(.snappy) {
      if expand {
        router.unfoldedProjects.insert(project.repoRoot)
      } else {
        router.unfoldedProjects.remove(project.repoRoot)
      }
    }
    Telemetry.capture(.sessionsFoldToggled(expanded: expand, done: triage.done.count, snoozed: triage.snoozed.count))
  }
}
