import ArgusCore
import SwiftUI

/// Where a share goes on the stack: a project's sessions, then the composer.
public enum ShareDestination: Hashable {
  case project(repoRoot: String)
  /// No session: a new worktree off the project.
  case compose(repoRoot: String, sessionId: String?)
}

/// What the share sheet is sending, as the picker shows it.
public struct ShareSummary {
  public var images: [PendingImage]
  public var hasLink: Bool
  public var hasText: Bool

  public init(images: [PendingImage] = [], hasLink: Bool = false, hasText: Bool = false) {
    self.images = images
    self.hasLink = hasLink
    self.hasText = hasText
  }
}

/// A paired computer the share can go to.
public struct ShareComputer: Identifiable, Hashable, Sendable {
  public let id: String
  public let label: String

  public init(id: String, label: String) {
    self.id = id
    self.label = label
  }
}

/// What's being sent, the computer it goes to, and that computer's projects.
public struct ShareProjectList: View {
  @Environment(HostStore.self) private var host
  let summary: ShareSummary
  let computers: [ShareComputer]
  let selectedId: String?
  let onSelect: @MainActor @Sendable (String) -> Void
  let onRetry: () -> Void

  public init(
    summary: ShareSummary, computers: [ShareComputer], selectedId: String?,
    onSelect: @escaping @MainActor @Sendable (String) -> Void, onRetry: @escaping () -> Void
  ) {
    self.summary = summary
    self.computers = computers
    self.selectedId = selectedId
    self.onSelect = onSelect
    self.onRetry = onRetry
  }

  private var label: String? { computers.first { $0.id == selectedId }?.label }

  public var body: some View {
    List {
      ShareSummarySection(summary: summary)
      Section { computerRow }
      if host.connection == .ready, host.projectsLoaded {
        if !host.hasControl {
          Section { MutedText("This phone can only watch \(label ?? "this computer"), not start agents.") }
        } else if host.projects.isEmpty {
          Section("Projects") { MutedText("Open a repository in Argus on \(label ?? "your Mac") first.") }
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
          Button("Try Again", action: onRetry)
        }
      } else {
        Section { Loading(label: "Connecting to \(label ?? "your computer")…") }
          .listRowBackground(Color.clear)
      }
    }
  }

  @ViewBuilder
  private var computerRow: some View {
    if computers.count > 1 {
      Picker(selection: Binding(get: { selectedId ?? "" }, set: onSelect)) {
        ForEach(computers) { Text($0.label).tag($0.id) }
      } label: {
        Label("Computer", systemImage: Icon.desktop)
      }
    } else if let label {
      Label(label, systemImage: Icon.desktop)
    }
  }
}

/// A preview of the shared images and a count of the links and text.
private struct ShareSummarySection: View {
  @Environment(\.theme) private var theme
  let summary: ShareSummary

  private var text: String {
    var parts: [String] = []
    if !summary.images.isEmpty { parts.append(summary.images.count == 1 ? "1 image" : "\(summary.images.count) images") }
    if summary.hasLink { parts.append("a link") }
    if summary.hasText { parts.append("text") }
    return parts.isEmpty ? "Nothing to attach — just the prompt" : parts.joined(separator: ", ")
  }

  var body: some View {
    Section("Sending") {
      VStack(alignment: .leading, spacing: 8) {
        if !summary.images.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
              ForEach(summary.images) { image in
                // Fit, not fill: a square crop of a screenshot is just its status bar.
                Image(platformImage: image.preview)
                  .resizable()
                  .scaledToFit()
                  .frame(height: 96)
                  .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
                  .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border))
              }
            }
          }
        }
        MutedText(text)
      }
    }
  }
}

/// A project's sessions: a new worktree first, then the ones already there.
/// `onPick` gets nil for the new worktree.
public struct ShareSessionList: View {
  @Environment(HostStore.self) private var host
  let repoRoot: String
  let onPick: (String?) -> Void

  public init(repoRoot: String, onPick: @escaping (String?) -> Void) {
    self.repoRoot = repoRoot
    self.onPick = onPick
  }

  private var project: RemoteProject? { host.projects.first { $0.repoRoot == repoRoot } }
  private var sessions: [RemoteSession] { host.sessionsByRepo[repoRoot] ?? [] }

  public var body: some View {
    List {
      Section {
        Button {
          onPick(nil)
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
              onPick(session.id)
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
