import ArgusCore
import ArgusUI
import SwiftUI

/// `/issues`: your open Linear issues assigned to you; clicking one opens it in Linear.
struct IssuesScreen: View {
  @Environment(HostStore.self) private var store

  var body: some View {
    IssuesScreenContent(model: LinearIssuesModel(host: store))
  }
}

private struct IssuesScreenContent: View {
  @Environment(\.openURL) private var openURL
  @State private var model: LinearIssuesModel

  init(model: LinearIssuesModel) {
    _model = State(initialValue: model)
  }

  var body: some View {
    LinearIssuesList(
      model: model,
      connectHint: "Connect Linear in Settings → Integrations to see the issues assigned to you.",
      onOpen: { issue in URL(string: issue.url).map { openURL($0) } }
    )
    .refreshingLinearIssues(model)
    .navigationTitle("Issues")
    .navigationSubtitle("Open issues assigned to you in Linear")
  }
}
