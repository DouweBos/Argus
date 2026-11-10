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
      if !store.pullRequests.isEmpty {
        if let error = store.error {
          Banner(text: PullRequestLabels.explain(error), tone: .danger).listRowBackground(Color.clear)
        }
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
    .loadPhase(
      LoadPhase(
        loaded: store.loaded, error: store.error.map(PullRequestLabels.explain),
        isEmpty: store.pullRequests.isEmpty),
      loading: "Asking GitHub…", failedTitle: "Couldn't fetch pull requests",
      retry: { await store.refresh() }
    ) {
      EmptyState(
        icon: Icon.pullRequests,
        title: "No pull requests",
        body: "Nothing open that's yours to review or land.")
    }
    .navigationTitle("Pull Requests")
    .refreshable { await store.refresh() }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(30)) {
      await store.refresh()
    }
  }
}

/// One PR in the list, as the Mac shows it: what it is, its review state,
/// who and where, and why you're seeing it.
struct PullRequestRow: View {
  @Environment(\.theme) private var theme
  let pullRequest: RemotePullRequest

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: Icon.pullRequest)
        .foregroundStyle(pullRequest.isDraft ? theme.textMuted : theme.success)
        .padding(.top, 2)
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          BodyText(pullRequest.title, lineLimit: 2)
          Spacer(minLength: 4)
          if pullRequest.isDraft {
            Badge(label: "Draft", tone: .muted)
          }
          if let decision = pullRequest.reviewDecision, let review = PullRequestLabels.review(decision) {
            Badge(label: review.label, tone: review.tone)
          }
        }
        MutedText(meta, lineLimit: 2)
        HStack(spacing: 4) {
          ForEach(pullRequest.reasons, id: \.self) { reason in
            Badge(label: PullRequestLabels.reason(reason), tone: PullRequestLabels.reasonTone(reason))
          }
          HStack(spacing: 3) {
            Image(systemName: Icon.branch)
            Text(pullRequest.headRef)
          }
            .font(.caption.monospaced())
            .foregroundStyle(theme.textSecondary)
            .lineLimit(1)
            .truncationMode(.middle)
        }
      }
    }
  }

  private var meta: String {
    let author = pullRequest.author.map { "by \($0)" } ?? "unknown author"
    return "\(pullRequest.repo) #\(pullRequest.number) · \(author) · updated \(PullRequestLabels.relative(pullRequest.updatedAt))"
  }
}
