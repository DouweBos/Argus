import ArgusUI
import SwiftUI

/// Every pull request the computer thinks is yours to look at, bucketed as the
/// Mac app does: what needs you first, the quiet ones after.
struct PullRequestsView: View {
  @Environment(HostStore.self) private var host
  @Environment(PullRequestsStore.self) private var store

  var body: some View {
    let groups = PullRequestBucket.group(store.pullRequests)
    List {
      if let error = store.error {
        Banner(text: PullRequestLabels.explain(error), tone: .danger).listRowBackground(Color.clear)
      }

      if !store.loaded {
        Loading(label: "Asking GitHub…").listRowBackground(Color.clear)
      } else if !store.pullRequests.isEmpty {
        if !groups.contains(where: { $0.bucket.needsAttention }) {
          Label("Nothing waiting on you right now.", systemImage: Icon.check)
            .foregroundStyle(.secondary)
        }
        ForEach(groups, id: \.bucket) { group in
          Section {
            ForEach(group.prs) { pullRequest in
              NavigationLink(
                value: Route.pullRequest(
                  repo: pullRequest.repo, number: pullRequest.number,
                  label: pullRequest.title)
              ) {
                PullRequestRow(pullRequest: pullRequest)
              }
            }
          } header: {
            Text("\(group.bucket.title) · \(group.prs.count)")
          }
        }
      }
    }
    .emptyState(when: store.loaded && store.pullRequests.isEmpty) {
      EmptyState(
        icon: Icon.pullRequests,
        title: "No pull requests",
        body: "Nothing open that's yours to review or land.")
    }
    .navigationTitle("Pull requests")
    .refreshable { await store.refresh() }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(30)) {
      await store.refresh()
    }
  }
}

/// One PR in the list: what it is, its review state, and why you're seeing it.
struct PullRequestRow: View {
  let pullRequest: RemotePullRequest

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        BodyText(pullRequest.title, lineLimit: 2)
        Spacer(minLength: 4)
        if pullRequest.isDraft {
          Badge(label: "Draft", tone: .muted)
        }
        if let decision = pullRequest.reviewDecision, let review = PullRequestLabels.review(decision) {
          Badge(label: review.label, tone: review.tone)
        }
      }
      MutedText(
        "\(pullRequest.repo) #\(pullRequest.number) · updated \(PullRequestLabels.relative(pullRequest.updatedAt))",
        lineLimit: 1)
      if !pullRequest.reasons.isEmpty {
        HStack(spacing: 4) {
          ForEach(pullRequest.reasons, id: \.self) { reason in
            Badge(label: PullRequestLabels.reason(reason), tone: PullRequestLabels.reasonTone(reason))
          }
        }
      }
    }
  }
}
