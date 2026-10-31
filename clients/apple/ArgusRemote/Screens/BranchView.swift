import ArgusUI
import SwiftUI

/// One branch: where it stands, what you can do with it, and its history.
///
/// Opened from the branches list. Actions need control; without it this is a
/// read-only view of the branch and its commits.
struct BranchView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.dismiss) private var dismiss

  let sessionId: String
  let repoRoot: String
  @State var branch: RemoteGitBranch

  @State private var current: String?
  @State private var commits: [RemoteCommit]?

  var body: some View {
    Screen {
      header
      if host.hasControl {
        BranchActionsView(
          sessionId: sessionId, repoRoot: repoRoot, branch: branch, current: current,
          onChanged: { await reload() },
          onRenamed: { name in
            branch.name = name
            await reload()
          },
          onDeleted: { dismiss() })
      }
      if let current, current != branch.name {
        Card(onTap: {
          router.push(.branchCompare(sessionId: sessionId, left: current, right: branch.ref))
        }) {
          HStack {
            BodyText("Compare with \(current)")
            Spacer(minLength: 6)
            Image(systemName: Icon.chevronRight)
              .font(.scaled(size: 12, weight: .semibold))
              .foregroundStyle(theme.textMuted)
          }
        }
      }
      history
    }
    .navigationTitle(branch.name)
    .navigationBarTitleDisplayMode(.inline)
    .task { await reload() }
    .refreshable { await reload() }
  }

  private var header: some View {
    Card {
      HStack(spacing: 6) {
        MonoText(text: branch.name, size: 14, color: theme.text, lineLimit: 2)
        Spacer(minLength: 6)
        if branch.pinned == true { Badge(label: "pinned") }
        if branch.isCurrent { Badge(label: "current", tone: .accent) }
        if branch.scope == .remote { Badge(label: branch.remote ?? "remote") }
      }
      if let upstream = branch.upstream {
        MutedText("Tracks \(upstream)")
      } else if branch.scope == .local {
        MutedText("Not published")
      }
      if branch.ahead > 0 || branch.behind > 0 {
        MutedText("\(branch.ahead) ahead · \(branch.behind) behind its upstream")
      }
    }
  }

  @ViewBuilder
  private var history: some View {
    SectionHeader(title: "History", count: commits?.count)
    if let commits {
      if commits.isEmpty {
        MutedText("No commits.")
      }
      ForEach(commits) { commit in
        CommitRow(subject: commit.subject, hash: commit.shortHash, author: commit.author,
                  millis: Self.millis(commit.date)) {
          router.push(.commit(sessionId: sessionId, hash: commit.hash, subject: commit.subject))
        }
      }
    } else {
      Loading(label: "Reading history…")
    }
  }

  private func reload() async {
    let branches = await host.listBranches(sessionId: sessionId)
    if let fresh = branches.first(where: { $0.id == branch.id }) {
      branch = fresh
    }
    current = branches.first(where: \.isCurrent)?.name
    commits = await host.branchLog(sessionId: sessionId, ref: branch.ref) ?? commits ?? []
  }

  private static let isoFormatter = ISO8601DateFormatter()

  static func millis(_ iso: String) -> Double? {
    isoFormatter.date(from: iso).map { $0.timeIntervalSince1970 * 1000 }
  }
}
