import ArgusUI
import SwiftUI

/// The computer's open Linear issues, as the desktop's `/issues`: assigned
/// to, created by or subscribed to by you, a section per status. Tapping one
/// opens it; agents start in the project picked in the toolbar.
struct IssuesView: View {
  @Environment(HostStore.self) private var host

  var body: some View {
    IssuesContent(model: LinearIssuesModel(host: host))
  }
}

private struct IssuesContent: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @State private var model: LinearIssuesModel

  init(model: LinearIssuesModel) {
    _model = State(initialValue: model)
  }

  var body: some View {
    LinearIssuesList(
      model: model,
      connectHint: "Connect Linear in Argus on your computer to see your issues here.",
      onOpen: { router.push(.issue(ref: $0.identifier)) }
    )
    .safeAreaInset(edge: .top, spacing: 0) {
      if host.linearConnected {
        SegmentedControl(
          value: $model.scope, options: ArgusProtocol.LinearIssueScope.all.map { ($0, $0.title) }
        )
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
      }
    }
    .refreshingLinearIssues(model)
    .navigationTitle("Issues")
  }
}
