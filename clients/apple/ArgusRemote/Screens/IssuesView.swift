import ArgusUI
import SwiftUI

/// The computer's open Linear issues, as the desktop's `/issues`: assigned
/// to, created by or subscribed to by you, a section per status, or a search
/// of the whole workspace. Tapping one opens it.
struct IssuesView: View {
  @Environment(HostStore.self) private var host

  var body: some View {
    IssuesContent(model: LinearIssuesModel(host: host))
  }
}

private struct IssuesContent: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @State private var model: LinearIssuesModel
  @State private var searchText = ""

  init(model: LinearIssuesModel) {
    model.onSearched = { Telemetry.capture(.issueSearched(results: $0)) }
    _model = State(initialValue: model)
  }

  var body: some View {
    LinearIssuesList(
      model: model,
      connectHint: "Connect Linear in Argus on your computer to see your issues here.",
      onOpen: { router.push(.issue(ref: $0.identifier)) }
    )
    // An empty list draws plain white; keep the grouped grey either way.
    .scrollContentBackground(.hidden)
    .background(theme.bg)
    .safeAreaInset(edge: .top, spacing: 0) {
      if host.linearConnected {
        VStack(spacing: 8) {
          // Results come from the whole workspace, not a scope.
          if model.query == nil {
            SegmentedControl(
              value: $model.scope, options: ArgusProtocol.LinearIssueScope.all.map { ($0, $0.title) }
            )
          }
          if let issues = model.issues, !issues.isEmpty {
            IssueFilterBar(issues: issues, states: model.workflowStates, filters: $model.filters)
          }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
      }
    }
    .searchable(if: host.linearConnected, text: $searchText, prompt: "Search all issues…")
    .task(id: searchText) {
      let term = LinearIssuesModel.term(searchText)
      guard term != model.query else { return }
      if term != nil {
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
      }
      model.query = term
    }
    .refreshingLinearIssues(model)
    .navigationTitle("Issues")
  }
}

extension View {
  /// Nothing to search until Linear is connected, so no field either.
  @ViewBuilder
  fileprivate func searchable(if enabled: Bool, text: Binding<String>, prompt: String) -> some View {
    if enabled {
      searchable(text: text, prompt: prompt)
    } else {
      self
    }
  }
}
