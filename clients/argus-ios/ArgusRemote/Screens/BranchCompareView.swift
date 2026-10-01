import ArgusUI
import SwiftUI

/// Where two branches diverged: the commits only one side has.
struct BranchCompareView: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  let sessionId: String
  let left: String
  let right: String

  @State private var result: RemoteBranchCompare?
  @State private var loaded = false

  var body: some View {
    Screen {
      if let result {
        Card {
          HStack(spacing: 6) {
            if let base = result.mergeBase {
              MutedText("Merge base")
              MonoText(text: String(base.prefix(8)), size: 12)
            } else {
              MutedText("No shared history")
            }
            Spacer(minLength: 6)
            if result.wouldConflict { Badge(label: "Conflicts likely", tone: .danger) }
          }
        }
        side("Only on \(left)", result.leftOnly)
        side("Only on \(right)", result.rightOnly)
      } else if loaded {
        MutedText("Couldn't compare these branches.")
      } else {
        Loading(label: "Comparing…")
      }
    }
    .navigationTitle("\(left) ↔ \(right)")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      result = await host.compareBranches(sessionId: sessionId, left: left, right: right)
      loaded = true
    }
  }

  @ViewBuilder
  private func side(_ title: String, _ commits: [RemoteCommitSummary]) -> some View {
    SectionHeader(title: title, count: commits.count)
    if commits.isEmpty {
      MutedText("Nothing.")
    }
    ForEach(commits) { commit in
      CommitRow(
        subject: commit.subject, hash: commit.hash, author: commit.author,
        millis: commit.timestamp
      ) {
        router.push(.commit(sessionId: sessionId, hash: commit.hash, subject: commit.subject))
      }
    }
  }
}
