import ArgusCore
import ArgusUI
import GroveKit
import SwiftUI

/// Settings → Git: the git panel's defaults on this Mac, and commit signing
/// for one repository at a time, as the desktop's Git and Git signing sections.
struct GitSettingsTab: View {
  @Environment(DesktopModel.self) private var model
  @AppStorage(GitPreferences.fileViewModeKey) private var fileViewMode = FileViewMode.flatModified.rawValue
  @AppStorage(GitPreferences.ignoreWhitespaceKey) private var ignoreWhitespace = false
  @State private var signingSession: String?

  private var diffLayout: Binding<DiffLayout> {
    Binding(get: { DiffLayoutSetting.shared.layout }, set: { DiffLayoutSetting.shared.set($0, via: .settings) })
  }

  /// One session per project: a repository's sessions share its config.
  private var projects: [RemoteSession] {
    model.store.projects.compactMap { project in
      let sessions = model.store.sessionsByRepo[project.repoRoot] ?? []
      return sessions.first { $0.kind == .projectRoot } ?? sessions.first
    }
  }

  var body: some View {
    SettingsPage {
      SettingsGroup(
        "Git",
        footer: "Defaults for every repository the git panel opens. The panel's own toggles change only the one on screen."
      ) {
        SettingsRow("Changes list", description: "How the changes list shows a working copy.") {
          Picker("Changes list", selection: $fileViewMode) {
            Text("List").tag(FileViewMode.flatModified.rawValue)
            Text("Tree").tag(FileViewMode.treeModified.rawValue)
            Text("All files").tag(FileViewMode.allFiles.rawValue)
          }
        }
        SettingsRow("Diff layout", description: "Unified in one column, or split side by side.") {
          Picker("Diff layout", selection: diffLayout) {
            ForEach(DiffLayout.allCases) { Text($0.title).tag($0) }
          }
        }
        SettingsToggleRow("Ignore whitespace in diffs", isOn: $ignoreWhitespace)
      }
      CommitMessageStyleSection()
      SettingsGroup("Git signing") {
        if projects.isEmpty {
          Text("Add a project to set up its commit signing.").foregroundStyle(.secondary)
        } else {
          SettingsRow("Repository", description: "Signing is set per repository.") {
            Picker("Repository", selection: $signingSession) {
              ForEach(projects) { session in
                Text((session.repoRoot as NSString).lastPathComponent).tag(Optional(session.id))
              }
            }
          }
        }
        if let signingSession {
          GitSigningSection(sessionId: signingSession, rows: true)
        }
      }
    }
    // Sessions arrive after the window does.
    .task(id: projects.map(\.id)) {
      guard signingSession == nil || !projects.contains(where: { $0.id == signingSession }) else { return }
      let onScreen = model.route.sessionId.flatMap { id in
        projects.first { $0.repoRoot == model.store.repoRoot(forSessionId: id) }?.id
      }
      signingSession = onScreen ?? projects.first?.id
    }
  }
}
