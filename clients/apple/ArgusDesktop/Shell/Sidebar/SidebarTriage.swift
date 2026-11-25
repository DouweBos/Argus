import ArgusCore
import ArgusUI
import SwiftUI

/// A session's sidebar menu, wherever its row sits: its project, Needs you or the scratch pads.
struct SidebarSessionMenu: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let session: RemoteSession

  private var stack: StackActions { StackActions(model: model, store: store) }

  var body: some View {
    if !session.isUnavailable {
      Button("Open in New Tab") {
        model.openTab(DesktopLocation(route: .session(id: session.id, agentId: nil), host: model.host(ofSession: session.id)))
      }
    }
    PullRequestWatchButton(session: session)
    Divider()
    SessionTriageMenu(session: session) { model.triageSheet = $0 }
    Divider()
    if session.kind == .worktree, session.status == .ready, !session.isUnavailable, session.compareGroup == nil {
      Button("New Session on Top of This One") { model.newSessionParent = session }
      if !stack.members(of: session).isEmpty {
        Button("Restack") { Task { await stack.restack(session) } }
        Button("Land Stack") { Task { await stack.land(session) } }
      }
      Divider()
    }
    switch session.kind {
    case .worktree:
      Button("Rename Session") { model.renamingSession = session }
      Button("Delete Session") { model.deletingSession = session }
    case .scratchPad:
      Button("Rename Scratch Pad") { model.renamingSession = session }
      Button("Delete Scratch Pad") { model.deletingSession = session }
    case .projectRoot, .automationHost:
      EmptyView()
    }
  }
}

/// Session rows with their menu, a compare run's under its header; `caption` adds a line under the
/// title, as Needs you names the project.
/// A stacked session sits under its parent when both are in these rows; apart, it says what it's on.
struct SidebarSessionRows: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let sessions: [RemoteSession]
  var caption: (RemoteSession) -> String? = { _ in nil }

  var body: some View {
    let arranged = SessionStack.arrange(sessions, session: { $0 }, all: store.sessionsByRepo.values.flatMap { $0 })
    ForEach(CompareGroup.split(arranged.items)) { item in
      switch item {
      case .session(let session): row(session, nesting: arranged.nesting[session.id] ?? .none)
      case .group(let run):
        // A compare run's slots sort as one, so they share a section under their run's header.
        SidebarCompareHeader(run: run)
        ForEach(run.sessions) { session in
          row(session, title: session.compareGroup.map(store.compareSlotTitle), indent: 1)
        }
      }
    }
  }

  /// A compare slot sits one level under its run's header; a stacked session under its parent.
  private func row(
    _ session: RemoteSession, title: String? = nil, indent: Int? = nil, nesting: SessionStack.Nesting = .none
  ) -> some View {
    SidebarRow(selected: model.route.sessionId == session.id, enabled: !session.isUnavailable) {
      model.open(session: session.id)
    } content: {
      SidebarSessionRow(
        session: session, agents: store.agents(inSession: session),
        caption: [caption(session), nesting.caption].compactMap { $0 }.joined(separator: " · ").nilIfEmpty,
        title: title, indent: indent ?? nesting.depth, stacked: nesting.depth > 0)
    }
    .contextMenu { SidebarSessionMenu(session: session) }
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
  let triage: SessionTriage
  @Binding var expanded: Bool

  var body: some View {
    if !triage.folded.isEmpty {
      SidebarRow(selected: false) { expanded.toggle() } content: {
        FoldedSessionsLabel(triage.foldedLabel, expanded: expanded)
          .padding(.vertical, 3)
      }
      .help(expanded ? "Hide done and snoozed sessions" : "Show done and snoozed sessions")
      if expanded {
        SidebarSessionRows(sessions: triage.done)
          .opacity(0.7)
        SidebarSessionRows(sessions: triage.snoozed)
      }
    }
  }
}

/// Snooze › Custom's day and time picker, or the status note, in a sheet.
private struct SessionTriageSheets: ViewModifier {
  @Environment(DesktopModel.self) private var model

  func body(content: Content) -> some View {
    content.sessionTriageSheet(Binding(get: { model.triageSheet }, set: { model.triageSheet = $0 }))
  }
}

extension View {
  func sessionTriageSheets() -> some View { modifier(SessionTriageSheets()) }
}
