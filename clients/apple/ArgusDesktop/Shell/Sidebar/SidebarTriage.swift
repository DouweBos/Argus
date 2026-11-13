import ArgusCore
import ArgusUI
import SwiftUI

/// A session's sidebar menu, wherever its row sits: its project, Needs you or the scratch pads.
struct SidebarSessionMenu: View {
  @Environment(DesktopModel.self) private var model
  let session: RemoteSession

  var body: some View {
    if !session.isUnavailable {
      Button("Open in New Tab") {
        model.openTab(DesktopLocation(route: .session(id: session.id, agentId: nil), host: model.host(ofSession: session.id)))
      }
    }
    PullRequestWatchButton(session: session)
    Divider()
    SessionTriageMenu(session: session) { model.snoozingSession = session }
    Divider()
    switch session.kind {
    case .worktree:
      Button("Rename Session…") { model.renamingSession = session }
      Button("Delete Session…") { model.deletingSession = session }
    case .scratchPad:
      Button("Rename Scratch Pad…") { model.renamingSession = session }
      Button("Delete Scratch Pad…") { model.deletingSession = session }
    case .projectRoot, .automationHost:
      EmptyView()
    }
  }
}

/// Session rows with their menu, a compare run's under its header; `caption` adds a line under the
/// title, as Needs you names the project.
struct SidebarSessionRows: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let sessions: [RemoteSession]
  var caption: (RemoteSession) -> String? = { _ in nil }

  var body: some View {
    ForEach(CompareGroup.split(sessions)) { item in
      switch item {
      case .session(let session): row(session)
      case .group(let run):
        // A compare run's slots sort as one, so they share a section under their run's header.
        SidebarCompareHeader(run: run)
        ForEach(run.sessions) { session in
          row(session, title: session.compareGroup.map(store.compareSlotTitle)).padding(.leading, 14)
        }
      }
    }
  }

  private func row(_ session: RemoteSession, title: String? = nil) -> some View {
    SidebarRow(selected: model.route.sessionId == session.id, enabled: !session.isUnavailable) {
      model.open(session: session.id)
    } content: {
      SidebarSessionRow(
        session: session, agents: store.agents(inSession: session), caption: caption(session), title: title)
    }
    .contextMenu { SidebarSessionMenu(session: session) }
  }
}

/// A section's quiet header: its title, a rule, and an optional trailing control.
struct SidebarSectionHeader<Trailing: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack {
      Text(title)
        .font(.scaled(size: 11, weight: .medium))
        .foregroundStyle(theme.textMuted)
      Rectangle().fill(theme.border).frame(height: 1)
      trailing
    }
    .padding(.leading, 8)
    .frame(minHeight: 20)
  }
}

extension SidebarSectionHeader where Trailing == EmptyView {
  init(title: String) {
    self.init(title: title) { EmptyView() }
  }
}

/// Every session that's waiting on you, from every project, above the projects.
struct NeedsYouSidebarSection: View {
  @Environment(HostStore.self) private var store
  let sessions: [RemoteSession]

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      SidebarSectionHeader(title: "Needs you")
      SidebarSessionRows(sessions: sessions) { session in
        session.isOutsideProjects ? "Scratch pad" : store.projects.first { $0.repoRoot == session.repoRoot }?.name
      }
    }
  }
}

/// Done and snoozed sessions, folded under one quiet row until asked for.
struct FoldedSessions: View {
  @Environment(\.theme) private var theme
  let triage: SessionTriage
  @Binding var expanded: Bool

  var body: some View {
    if !triage.folded.isEmpty {
      SidebarRow(selected: false) { expanded.toggle() } content: {
        HStack(spacing: 6) {
          Image(systemName: expanded ? Icon.chevronDown : Icon.chevronRight)
            .font(.scaled(size: 9, weight: .semibold))
            .frame(width: 8)
          Text(label).font(.scaled(size: 11))
          Spacer(minLength: 0)
        }
        .foregroundStyle(theme.textMuted)
        .padding(.vertical, 3)
      }
      .help(expanded ? "Hide done and snoozed sessions" : "Show done and snoozed sessions")
      .accessibilityLabel(label)
      .accessibilityValue(expanded ? "Expanded" : "Collapsed")
      if expanded {
        SidebarSessionRows(sessions: triage.done)
          .opacity(0.7)
        SidebarSessionRows(sessions: triage.snoozed)
      }
    }
  }

  private var label: String {
    var parts: [String] = []
    if !triage.done.isEmpty { parts.append("\(triage.done.count) done") }
    if !triage.snoozed.isEmpty { parts.append("\(triage.snoozed.count) snoozed") }
    return parts.joined(separator: " · ")
  }
}

/// Snooze › Custom…: a day and time picker in a sheet.
private struct SnoozeSessionSheet: ViewModifier {
  @Environment(DesktopModel.self) private var model

  func body(content: Content) -> some View {
    content.sheet(item: snoozing) { session in
      NavigationStack { SnoozeUntilForm(session: session) }
        .frame(width: 340, height: 440)
    }
  }

  private var snoozing: Binding<RemoteSession?> {
    Binding(get: { model.snoozingSession }, set: { model.snoozingSession = $0 })
  }
}

extension View {
  func snoozeSessionSheet() -> some View { modifier(SnoozeSessionSheet()) }
}
