import ArgusCore
import ArgusUI
import SwiftUI

/// The title over a new agent's composer: "What should we build in <project>?",
/// the project a picker to start in another, or a scratch pad with none.
struct AgentStartTitle: View {
  @Environment(\.theme) private var theme
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let sessionId: String

  private var session: RemoteSession? { model.session(sessionId) }

  private var project: RemoteProject? {
    guard let session, !session.isOutsideProjects else { return nil }
    return store.projects.first { $0.repoRoot == session.repoRoot }
  }

  var body: some View {
    VStack(spacing: 6) {
      if let project {
        AgentStartHeading { projectMenu(project) }
        Button("or start without a project") {
          Task { await model.newScratchPad() }
        }
        .buttonStyle(.argusPlain)
        .font(.scaled(size: 13))
        .foregroundStyle(theme.textSecondary)
        .help("Start in a scratch pad, outside any project")
      } else {
        AgentStartHeading()
        if let session {
          Text(store.placeName(of: session))
            .font(.scaled(size: 13))
            .foregroundStyle(theme.textSecondary)
        }
      }
    }
    .lineLimit(1)
    .multilineTextAlignment(.center)
    .frame(maxWidth: .infinity)
    .readingColumn()
  }

  private func projectMenu(_ current: RemoteProject) -> some View {
    ChromeMenuButton {
      ChromeMenuEntry.header("Project")
      for project in store.projects {
        ChromeMenuItem(
          project.name, icon: .badge(project.name, key: project.repoRoot),
          checked: project.repoRoot == current.repoRoot
        ) {
          guard project.repoRoot != current.repoRoot else { return }
          Task { await model.openProjectRoot(project.repoRoot) }
        }
      }
    } label: { _ in
      Text(current.name)
        .underline(pattern: .dot, color: theme.textMuted)
        .truncationMode(.middle)
    }
    .buttonStyle(.argusPlain)
    .help("Start in another project")
  }
}
