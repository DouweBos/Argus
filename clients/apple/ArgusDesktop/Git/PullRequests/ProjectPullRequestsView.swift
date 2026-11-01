import ArgusUI
import GroveKit
import SwiftUI

/// The git panel's Pull Requests: the PRs of interest in this project only,
/// and opening a new one for a session branch.
struct ProjectPullRequestsView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  let repoRoot: String
  @State private var creating = false
  @State private var refreshing = false

  private var prs: PullRequestsStore { model.pullRequests }
  private var mine: [RemotePullRequest] { prs.pullRequests.filter { $0.repoRoot == repoRoot } }

  /// Worktree sessions with a branch and base to open a PR from.
  private var sessions: [RemoteSession] {
    (store.sessionsByRepo[repoRoot] ?? []).filter { $0.kind != .projectRoot && $0.baseBranch != nil }
  }

  var body: some View {
    VStack(spacing: 0) {
      GitToolHeader(title: "Pull Requests", caption: caption) {
        Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
          .help("Refresh")
          .disabled(refreshing)
        Button("New Pull Request…") { creating = true }
          .disabled(sessions.isEmpty)
          .help(sessions.isEmpty ? "Create a session to open a pull request from its branch" : "")
      }
      Divider()
      PullRequestList(
        pullRequests: mine, loaded: prs.loaded, error: prs.error, showsRepo: false,
        emptyTitle: "No open pull requests",
        emptyText: "When this project has open PRs that involve you, they'll show up here."
      ) { Task { await refresh() } }
    }
    .task { await refresh() }
    .sheet(isPresented: $creating) {
      OpenPullRequestSheet(sessionId: sessions.first?.id ?? "", choices: sessions, draft: false)
    }
  }

  private var caption: String? {
    guard prs.loaded else { return nil }
    return "\(mine.count) open · authored, reviewing, or commented\(refreshing ? " · refreshing…" : "")"
  }

  private func refresh() async {
    refreshing = true
    await prs.refresh()
    refreshing = false
  }
}
