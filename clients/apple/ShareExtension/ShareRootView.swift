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
            ShareSessionList(model: model, repoRoot: repoRoot)
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
      ShareProjectList(model: model)
    }
  }
}

/// What's being sent, the computer it goes to, and that computer's projects.
private struct ShareProjectList: View {
  @Environment(HostStore.self) private var host
  let model: ShareModel

  var body: some View {
    List {
      SharedItemsSection(items: model.items)
      Section("Computer") { computerRow }
      if host.connection == .ready, host.projectsLoaded {
        if !host.hasControl {
          Section { MutedText("This phone can only watch \(model.identity?.label ?? "this computer"), not start agents.") }
        } else if host.projects.isEmpty {
          Section("Projects") { MutedText("Open a repository in Argus on \(model.identity?.label ?? "your Mac") first.") }
        } else {
          Section("Projects") {
            ForEach(host.projects) { project in
              NavigationLink(value: ShareDestination.project(repoRoot: project.repoRoot)) {
                HStack(spacing: 10) {
                  ProjectBadge(project.name, key: project.repoRoot, size: 22)
                  Text(project.name).lineLimit(1)
                }
              }
            }
          }
        }
      } else if host.connection == .offline, let error = host.lastError {
        Section {
          MutedText(error)
          Button("Try Again") { Task { await model.connect() } }
        }
      } else {
        Section { Loading(label: "Connecting to \(model.identity?.label ?? "your computer")…") }
          .listRowBackground(Color.clear)
      }
    }
  }

  @ViewBuilder
  private var computerRow: some View {
    if model.hosts.count > 1 {
      Picker(selection: Binding(get: { model.hostId ?? "" }, set: { id in Task { await model.select(hostId: id) } })) {
        ForEach(model.hosts) { Text($0.label).tag($0.deviceId) }
      } label: {
        Label("Computer", systemImage: Icon.desktop)
      }
    } else if let identity = model.identity {
      Label(identity.label, systemImage: Icon.desktop)
    }
  }
}

/// A preview of the shared images and a count of the links and text.
private struct SharedItemsSection: View {
  @Environment(\.theme) private var theme
  let items: SharedItems

  private var summary: String {
    var parts: [String] = []
    if !items.images.isEmpty { parts.append(items.images.count == 1 ? "1 image" : "\(items.images.count) images") }
    if items.hasLink { parts.append("a link") }
    if items.hasText { parts.append("text") }
    return parts.isEmpty ? "Nothing to attach — just the prompt" : parts.joined(separator: ", ")
  }

  var body: some View {
    Section("Sending") {
      VStack(alignment: .leading, spacing: 8) {
        if !items.images.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
              ForEach(items.images) { image in
                Image(platformImage: image.preview)
                  .resizable()
                  .scaledToFill()
                  .frame(width: 56, height: 56)
                  .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
              }
            }
          }
        }
        MutedText(summary)
      }
    }
  }
}

/// A project's sessions: a new worktree first, then the ones already there.
private struct ShareSessionList: View {
  @Environment(HostStore.self) private var host
  let model: ShareModel
  let repoRoot: String

  private var project: RemoteProject? { host.projects.first { $0.repoRoot == repoRoot } }
  private var sessions: [RemoteSession] { host.sessionsByRepo[repoRoot] ?? [] }

  var body: some View {
    List {
      Section {
        Button {
          model.compose(repoRoot: repoRoot, sessionId: nil)
        } label: {
          Label {
            VStack(alignment: .leading, spacing: 2) {
              Text(StartWorkspace.worktreeLabel)
              MutedText(StartWorkspace.worktreeHint)
            }
          } icon: {
            Image(systemName: "folder.badge.plus")
          }
        }
        .buttonStyle(.argusPlain)
      }
      Section("Sessions") {
        if host.sessionsByRepo[repoRoot] == nil {
          Loading(label: "Loading sessions…").listRowBackground(Color.clear)
        } else {
          ForEach(sessions) { session in
            Button {
              model.compose(repoRoot: repoRoot, sessionId: session.id)
            } label: {
              SessionRow(session: session, agents: host.agents(inSession: session), detailed: true)
            }
            .buttonStyle(.argusPlain)
            .disabled(session.isUnavailable || session.status != .ready)
          }
        }
      }
    }
    .navigationTitle(project?.name ?? "Project")
    .task { await host.loadSessions(repoRoot: repoRoot) }
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
