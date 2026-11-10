import ArgusUI
import SwiftUI

/// The share sheet: which computer, which project, a new or existing session,
/// then the start composer with the shared items already in it.
struct ShareRootView: View {
  @Environment(\.colorScheme) private var systemScheme
  @Bindable var model: ShareModel

  private var preference: ThemePreference {
    ThemePreference(rawValue: model.snapshot?.theme ?? "") ?? .system
  }

  private var theme: Theme {
    Theme.resolved(
      for: preference.colorScheme ?? systemScheme, colorTheme: .sanitize(model.snapshot?.colorTheme))
  }

  var body: some View {
    NavigationStack(path: $model.path) {
      content
        .navigationTitle("Send to Argus")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { model.cancel() }
          }
        }
        .navigationDestination(for: ShareDestination.self) { destination in
          switch destination {
          case .project(let repoRoot):
            ShareSessionList(repoRoot: repoRoot) { model.compose(repoRoot: repoRoot, sessionId: $0) }
          case .compose(let repoRoot, let sessionId):
            ShareComposer(model: model, repoRoot: repoRoot, sessionId: sessionId)
          }
        }
    }
    .environment(model.host)
    .environment(\.theme, theme)
    .tint(theme.accent)
    .preferredColorScheme(preference.colorScheme)
    .task { await model.begin() }
  }

  @ViewBuilder
  private var content: some View {
    switch model.phase {
    case .loading:
      Loading(label: "Opening…")
    case .locked:
      EmptyState(icon: Icon.lock, title: "Argus is locked", body: "Unlock it to send this to a computer.") {
        Btn(label: "Unlock", hugs: true) { Task { await model.unlock() } }
      }
    case .unpaired:
      EmptyState(
        icon: Icon.desktop, title: "No computers paired",
        body: "Open Argus and pair it with your Mac, then share again.")
    case .ready:
      ShareProjectList(
        summary: model.items.summary, computers: model.hosts.map { ShareComputer(id: $0.deviceId, label: $0.label) },
        selectedId: model.hostId, onSelect: { id in Task { await model.select(hostId: id) } },
        onRetry: { Task { await model.connect() } })
    }
  }
}

/// The app's start composer, seeded with the share. A new session starts once
/// its worktree is set up, on the computer, so the sheet can close at once.
private struct ShareComposer: View {
  @Environment(HostStore.self) private var host
  let model: ShareModel
  let repoRoot: String
  let sessionId: String?

  var body: some View {
    AgentStartPane(
      repoRoot: repoRoot, sessionId: sessionId ?? model.rootSessionId(repoRoot),
      workspace: sessionId == nil ? .worktree : .current, defaultMode: model.defaultMode, hostWaits: true
    ) { _, sent in
      model.started(workspace: sent.workspace)
    }
    .navigationTitle(sessionId == nil ? "New Session" : "New Agent")
  }
}
