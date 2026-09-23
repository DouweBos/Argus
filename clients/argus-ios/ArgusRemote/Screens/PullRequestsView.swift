import ArgusKit
import SwiftUI

/// Every pull request the computer thinks is yours to look at — authored by
/// you, assigned to you, or waiting on your review.
struct PullRequestsView: View {
  @Environment(AppStore.self) private var app
  @Environment(PullRequestsStore.self) private var store

  var body: some View {
    List {
      if let error = store.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }

      if !store.loaded {
        Loading(label: "Asking GitHub…").listRowBackground(Color.clear)
      } else if store.pullRequests.isEmpty {
        EmptyState(
          icon: Icon.repo,
          title: "No pull requests",
          body: "Nothing open that's yours to review or land."
        )
        .listRowBackground(Color.clear)
      } else {
        ForEach(store.pullRequests) { pullRequest in
          NavigationLink(
            value: Route.pullRequest(
              repo: pullRequest.repo, number: pullRequest.number,
              label: pullRequest.title)
          ) {
            PullRequestRow(pullRequest: pullRequest)
          }
        }
      }
    }
    .navigationTitle("Pull requests")
    .refreshable { await store.refresh() }
    .liveRefresh(enabled: app.connection == .ready, every: .seconds(30)) {
      await store.refresh()
    }
  }
}

/// One PR in the list: what it is, where it's going, and why you're seeing it.
struct PullRequestRow: View {
  @Environment(\.theme) private var theme
  let pullRequest: RemotePullRequest

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        BodyText(pullRequest.title, lineLimit: 2)
        Spacer(minLength: 4)
        if pullRequest.isDraft {
          Badge(label: "draft", tone: .muted)
        }
        if let decision = pullRequest.reviewDecision, let tone = reviewTone(decision) {
          Badge(label: reviewLabel(decision), tone: tone)
        }
      }
      MutedText("\(pullRequest.repo) #\(pullRequest.number)", lineLimit: 1)
      if !pullRequest.reasons.isEmpty {
        MutedText(pullRequest.reasons.joined(separator: " · "), lineLimit: 1)
      }
    }
  }

  private func reviewLabel(_ decision: String) -> String {
    switch decision {
    case "APPROVED": "approved"
    case "CHANGES_REQUESTED": "changes"
    case "REVIEW_REQUIRED": "review"
    default: decision.lowercased()
    }
  }

  private func reviewTone(_ decision: String) -> Tone? {
    switch decision {
    case "APPROVED": .success
    case "CHANGES_REQUESTED": .danger
    case "REVIEW_REQUIRED": .warning
    default: nil
    }
  }
}
