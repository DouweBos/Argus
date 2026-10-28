import ArgusCore
import SwiftUI

/// Your open Linear issues, grouped by where they are in the workflow, with
/// the session already on each or a start. The native `/issues`.
public struct LinearIssuesList: View {
  @Environment(HostStore.self) private var host
  /// False greys out "Start agent": no project picked, or no control.
  let canStart: Bool
  /// What to say while Linear isn't connected: where to connect it.
  let connectHint: String
  let onOpenSession: (RemoteSession) -> Void
  let onStart: (HostStore.LinearIssue) -> Void

  @State private var issues: [HostStore.LinearIssue]?
  @State private var error: String?

  public init(
    canStart: Bool,
    connectHint: String,
    onOpenSession: @escaping (RemoteSession) -> Void,
    onStart: @escaping (HostStore.LinearIssue) -> Void
  ) {
    self.canStart = canStart
    self.connectHint = connectHint
    self.onOpenSession = onOpenSession
    self.onStart = onStart
  }

  public var body: some View {
    List {
      if let error, issues != nil {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }
      ForEach(LinearIssueBoard.groups(issues ?? [])) { group in
        Section {
          ForEach(group.issues) { issue in
            LinearIssueRow(
              issue: issue, session: host.session(workingOn: issue), canStart: canStart,
              onOpenSession: onOpenSession, onStart: { onStart(issue) })
          }
        } header: {
          Text("\(group.title) · \(group.issues.count)")
        }
      }
    }
    // Over the list, not in it: a row only gets its own height.
    .overlay { placeholder }
    .refreshable { await refresh() }
    .task(id: host.connection == .ready) {
      guard host.connection == .ready else { return }
      await host.loadIntegrations()
      await refresh()
    }
    .liveRefresh(enabled: host.connection == .ready && host.linearConnected, every: .seconds(300)) {
      await refresh()
    }
  }

  @ViewBuilder private var placeholder: some View {
    if !host.linearConnected {
      EmptyState(icon: Icon.issue, title: "Linear isn't connected", body: connectHint)
    } else if let error, issues == nil {
      EmptyState(icon: Icon.warning, title: "Couldn't fetch your issues", body: error, selectable: true)
    } else if issues == nil {
      Loading(label: "Asking Linear…")
    } else if issues?.isEmpty == true {
      EmptyState(
        icon: Icon.check, title: "Nothing assigned to you",
        body: "Open issues assigned to you in Linear show up here.")
    }
  }

  private func refresh() async {
    guard host.linearConnected else {
      issues = nil
      error = nil
      return
    }
    do {
      let found = try await host.linearIssues(query: "", limit: 100)
      issues = found
      error = nil
    } catch {
      self.error = HostStore.describe(error)
    }
    // "Open session" needs every project's sessions, not just the ones opened.
    for project in host.projects {
      await host.loadSessions(repoRoot: project.repoRoot)
    }
  }
}

/// One issue: what it is, how pressing, and what Argus is doing about it.
public struct LinearIssueRow: View {
  @Environment(\.theme) private var theme
  let issue: HostStore.LinearIssue
  let session: RemoteSession?
  let canStart: Bool
  let onOpenSession: (RemoteSession) -> Void
  let onStart: () -> Void

  public init(
    issue: HostStore.LinearIssue, session: RemoteSession?, canStart: Bool,
    onOpenSession: @escaping (RemoteSession) -> Void, onStart: @escaping () -> Void
  ) {
    self.issue = issue
    self.session = session
    self.canStart = canStart
    self.onOpenSession = onOpenSession
    self.onStart = onStart
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(issue.identifier)
          .font(.scaled(size: 12, design: .monospaced))
          .foregroundStyle(theme.textMuted)
        BodyText(issue.title, lineLimit: 2)
      }
      FlowRow(spacing: 6, rowSpacing: 6) {
        MutedText(issue.state.name, lineLimit: 1)
        if let priority = LinearIssueBoard.priority(issue.priority) {
          Badge(label: priority, tone: LinearIssueBoard.isPressing(issue.priority) ? .warning : .muted)
        }
        ForEach(issue.labels, id: \.self) { Badge(label: $0) }
      }
      HStack(spacing: 8) {
        if let session {
          Btn(label: "Open session", tone: .secondary, small: true, icon: Icon.agent, hugs: true) {
            onOpenSession(session)
          }
        } else {
          Btn(label: "Start agent", small: true, icon: Icon.play, hugs: true, action: onStart)
            .disabled(!canStart)
        }
        if let url = URL(string: issue.url) {
          Link(destination: url) {
            Label("Linear", systemImage: Icon.openExternal)
              .font(.scaled(size: 13, weight: .semibold))
              .foregroundStyle(theme.textSecondary)
          }
          .clickable()
          .help("Open \(issue.identifier) in Linear")
        }
      }
    }
    .padding(.vertical, 4)
  }
}
