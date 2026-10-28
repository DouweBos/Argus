import ArgusCore
import ArgusUI
import SwiftUI

/// `/issues`: your open Linear issues, with the session already on each or
/// a start in the project picked in the toolbar.
struct IssuesScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var pickedRoot: String?
  @State private var starting: HostStore.LinearIssue?

  private var project: RemoteProject? {
    store.projects.first { $0.repoRoot == pickedRoot } ?? store.projects.first
  }

  var body: some View {
    LinearIssuesList(
      canStart: store.hasControl && project != nil,
      connectHint: "Connect Linear in Settings → Integrations to see the issues assigned to you.",
      onOpenSession: { model.open(session: $0.id) },
      onStart: { starting = $0 }
    )
    .navigationTitle("Issues")
    .navigationSubtitle("Open issues assigned to you in Linear")
    .toolbar {
      if store.linearConnected, store.projects.count > 1 {
        ToolbarItem {
          Picker("Start in", selection: projectSelection) {
            ForEach(store.projects) { Text("Start in \($0.name)").tag(String?.some($0.repoRoot)) }
          }
          .fixedSize()
          .help("The project new agents start in")
        }
      }
    }
    .sheet(item: $starting) { issue in
      if let project {
        NewSessionSheet(project: project, issues: [issue]) { session in
          model.openAgents(session: session.id)
        }
      }
    }
  }

  private var projectSelection: Binding<String?> {
    Binding(get: { project?.repoRoot }, set: { pickedRoot = $0 })
  }
}
