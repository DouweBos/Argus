import ArgusCore
import SwiftUI

/// `/sessions/archived`: every archived session by project, newest archived first, each with Restore.
/// The Mac's Archived screen and the phone's both draw it.
public struct ArchivedSessionsList: View {
  @Environment(HostStore.self) private var host
  let open: (RemoteSession) -> Void
  /// The row's menu, e.g. the triage menu with its sheets presented by the caller.
  let menu: (RemoteSession) -> AnyView

  public init(open: @escaping (RemoteSession) -> Void, menu: @escaping (RemoteSession) -> AnyView = { _ in AnyView(EmptyView()) }) {
    self.open = open
    self.menu = menu
  }

  public var body: some View {
    let archived = host.archivedSessions
    Group {
      if archived.isEmpty {
        EmptyState(
          icon: Icon.archive, title: "Nothing archived",
          body: "Archive a session from its menu to hide it from the list. It comes back here, worktree and all.")
      } else {
        List {
          ForEach(groups(archived), id: \.title) { group in
            Section(group.title) {
              ForEach(group.sessions) { session in
                row(session)
              }
            }
          }
        }
        #if os(macOS)
          .listStyle(.inset)
        #endif
      }
    }
    .navigationTitle("Archived")
  }

  private func row(_ session: RemoteSession) -> some View {
    HStack(spacing: 8) {
      Button { open(session) } label: {
        SessionRow(
          session: session, agents: host.agents(inSession: session), detailed: Self.detailed,
          caption: session.archivedAt.map { "Archived \(ChromeText.shortAge($0)) ago" })
          .contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
      .disabled(session.isUnavailable)
      if host.hasControl {
        Button("Restore") { Task { await host.setSessionArchived(session, archived: false) } }
          .buttonStyle(.bordered)
          .controlSize(.small)
      }
    }
    .contextMenu { menu(session) }
  }

  private struct ProjectGroup {
    let title: String
    let sessions: [RemoteSession]
  }

  /// One section per project in the projects' order, scratch pads last.
  private func groups(_ sessions: [RemoteSession]) -> [ProjectGroup] {
    var result = host.projects.compactMap { project -> ProjectGroup? in
      let mine = sessions.filter { $0.repoRoot == project.repoRoot && !$0.isOutsideProjects }
      return mine.isEmpty ? nil : ProjectGroup(title: project.name, sessions: mine)
    }
    let pads = sessions.filter(\.isOutsideProjects)
    if !pads.isEmpty { result.append(ProjectGroup(title: "Scratch pads", sessions: pads)) }
    return result
  }

  #if os(iOS)
    private static let detailed = true
  #else
    private static let detailed = false
  #endif
}
