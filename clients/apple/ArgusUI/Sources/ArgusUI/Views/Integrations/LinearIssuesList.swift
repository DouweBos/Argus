import ArgusCore
import SwiftUI

/// Open Linear issues in one scope, or a search's results, a section per
/// status with the most urgent first — the desktop's Issues list. Tapping one opens it. The
/// screen keeps it loaded with `refreshingLinearIssues`.
public struct LinearIssuesList: View {
  @Environment(HostStore.self) private var host
  let model: LinearIssuesModel
  /// What to say while Linear isn't connected: where to connect it.
  let connectHint: String
  /// The issue open in the detail, highlighted.
  let selected: String?
  let onOpen: (HostStore.LinearIssue) -> Void

  public init(
    model: LinearIssuesModel, connectHint: String, selected: String? = nil,
    onOpen: @escaping (HostStore.LinearIssue) -> Void
  ) {
    self.model = model
    self.connectHint = connectHint
    self.selected = selected
    self.onOpen = onOpen
  }

  public var body: some View {
    List {
      if let error = model.error, model.issues != nil {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }
      ForEach(LinearIssueBoard.columns(model.shownIssues ?? [])) { column in
        Section {
          ForEach(column.issues.sorted(by: LinearIssueBoard.byPriority)) { issue in
            Button {
              onOpen(issue)
            } label: {
              LinearIssueCard(
                issue: issue, agentOnIt: host.session(workingOn: issue) != nil, style: .row)
            }
            .buttonStyle(.argusPlain)
            .listRowBackground(issue.identifier == selected ? LinearIssueSelection() : nil)
          }
        } header: {
          HStack(spacing: 6) {
            IssueStatusGlyph(type: column.type, color: column.color, size: 12)
            Text("\(column.name) · \(column.issues.count)")
          }
        }
      }
    }
    // Over the list, not in it: a row only gets its own height.
    .overlay { LinearIssuesPlaceholder(model: model, connectHint: connectHint) }
    .refreshable { await model.refresh() }
  }
}

private struct LinearIssueSelection: View {
  @Environment(\.theme) private var theme
  var body: some View { theme.selection }
}

/// Not connected, failed, loading or empty: what the Issues screen shows in
/// place of issues.
public struct LinearIssuesPlaceholder: View {
  @Environment(HostStore.self) private var host
  let model: LinearIssuesModel
  let connectHint: String

  public init(model: LinearIssuesModel, connectHint: String) {
    self.model = model
    self.connectHint = connectHint
  }

  public var body: some View {
    if !host.linearConnected {
      EmptyState(icon: Icon.issue, title: "Linear isn't connected", body: connectHint)
    } else if let error = model.error, model.issues == nil {
      EmptyState(
        icon: Icon.warning, title: model.query == nil ? "Couldn't fetch your issues" : "Couldn't search Linear",
        body: error, selectable: true)
    } else if model.issues == nil {
      Loading(label: model.query == nil ? "Asking Linear…" : "Searching Linear…")
    } else if let query = model.query, model.issues?.isEmpty == true {
      EmptyState(
        icon: Icon.search, title: "No issues match \u{201C}\(query)\u{201D}",
        body: "Search looks through every issue in your Linear workspace.")
    } else if model.issues?.isEmpty == true {
      EmptyState(icon: Icon.check, title: "No open issues", body: model.scope.emptyText)
    } else if model.shownIssues?.isEmpty == true {
      EmptyState(icon: Icon.filter, title: "No issues match", body: "Change or clear the filters to see more.")
    }
  }
}

extension View {
  /// Loads the issues once the host is ready and whenever the scope or search changes,
  /// then every five minutes while Linear is connected.
  public func refreshingLinearIssues(_ model: LinearIssuesModel) -> some View {
    modifier(LinearIssuesRefresh(model: model))
  }
}

private struct LinearIssuesRefresh: ViewModifier {
  @Environment(HostStore.self) private var host
  let model: LinearIssuesModel

  func body(content: Content) -> some View {
    content
      .task(id: Key(ready: host.connection == .ready, scope: model.scope.rawValue, query: model.query)) {
        guard host.connection == .ready else { return }
        await host.loadIntegrations()
        await model.refresh()
      }
      .liveRefresh(enabled: host.connection == .ready && host.linearConnected, every: .seconds(300)) {
        await model.refresh()
      }
  }

  private struct Key: Equatable {
    let ready: Bool
    let scope: String
    let query: String?
  }
}
