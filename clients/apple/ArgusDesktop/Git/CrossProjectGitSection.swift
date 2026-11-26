import ArgusCore
import ArgusUI
import SwiftUI

/// A cross-project session's repositories above the refs: each opens its own
/// git view, where it commits, merges and opens its pull request on its own.
struct CrossProjectGitSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let session: RemoteSession
  let view: GitRoute

  var body: some View {
    let repos = store.crossProjectRepos(of: session)
    if !repos.isEmpty {
      VStack(alignment: .leading, spacing: 4) {
        Text("Repositories")
          .font(.scaled(size: 11, weight: .semibold))
          .foregroundStyle(theme.textMuted)
          .padding(.horizontal, 8)
        CrossProjectRepoList(repos: repos, currentSessionId: session.id) { repo in
          model.navigate(.sessionGit(id: repo.sessionId, view: Self.carried(view)))
        }
      }
      .padding(.horizontal, 6)
      .padding(.vertical, 8)
      Rectangle().fill(theme.border).frame(height: 1)
    }
  }

  /// The changes views carry over to the other repository; anything tied to this one's refs starts at its branch.
  static func carried(_ view: GitRoute) -> GitRoute {
    switch view {
    case .working, .branch, .history, .stashes, .pullRequests: view
    default: .branch
    }
  }
}
