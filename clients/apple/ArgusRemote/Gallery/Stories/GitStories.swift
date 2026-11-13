#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The phone's git screens on `GalleryGit`'s repository, the Mac's git stories' twins.
  enum GitStories {
    private static let root = GalleryGit.rootSessionId
    private static let worktree = GalleryGit.worktreeSessionId

    static var all: [GalleryStory] {
      [
        GalleryStory("git/changes", fixtures: fixtures(worktree), setup: sessions) {
          ChangesView(sessionId: worktree, label: "Merge strategy")
        },
        GalleryStory("git/changes/last-turn", fixtures: fixtures(worktree), setup: sessions) {
          ChangesView(sessionId: worktree, label: "Merge strategy", mode: "turn")
        },
        GalleryStory("git/file-diff", fixtures: fixtures(worktree), setup: sessions) {
          FileDiffView(sessionId: worktree, path: "src/session/merge.ts", mode: "working")
        },
        GalleryStory("git/branches", fixtures: fixtures(root), setup: sessions) {
          BranchesView(sessionId: root, repoRoot: GalleryGit.repoRoot, label: "luma")
        },
        GalleryStory("git/branch", fixtures: fixtures(root), setup: sessions) {
          BranchView(sessionId: root, repoRoot: GalleryGit.repoRoot, branch: branch)
        },
        GalleryStory("git/compare", fixtures: fixtures(root), setup: sessions) {
          BranchCompareView(sessionId: root, left: "main", right: GalleryGit.branch)
        },
        GalleryStory("git/commit", fixtures: fixtures(root), setup: sessions) {
          CommitView(
            sessionId: root, hash: "be0f64aa5da08bb03468cd5b4597dee33a4282d2",
            subject: "feat(session): merge a session back into its base branch")
        },
        GalleryStory("git/stashes", fixtures: fixtures(root), setup: sessions) {
          StashesView(sessionId: root, label: "luma")
        },
        GalleryStory("git/pull-requests", fixtures: GalleryFixtures.pullRequests) {
          PullRequestsView()
        },
        GalleryStory("git/pull-request", fixtures: GalleryFixtures.pullRequests) {
          PullRequestView(repo: "acme/luma", number: 482, label: "Pick a merge strategy per project")
        },
        GalleryStory("git/review-guide", fixtures: GalleryFixtures.reviewGuide(.ready), setup: sessions) {
          ReviewGuideView(target: .session(id: worktree), label: "Guide")
        },
        GalleryStory("git/review-guide/pull-request", fixtures: GalleryFixtures.reviewGuide(.ready)) {
          ReviewGuideView(target: .pullRequest(repo: "acme/luma", number: 482, headSha: nil), label: "#482 guide")
        },
        GalleryStory("git/review-guide/generating", fixtures: GalleryFixtures.reviewGuide(.generating)) {
          ReviewGuideView(target: .session(id: worktree), label: "Guide")
        },
        GalleryStory("git/review-guide/failed", fixtures: GalleryFixtures.reviewGuide(.failed)) {
          ReviewGuideView(target: .session(id: worktree), label: "Guide")
        },
      ]
    }

    private static func fixtures(_ sessionId: String) -> [String: String] {
      GalleryFixtures.git(sessionId: sessionId).merging(GalleryFixtures.pullRequests) { git, _ in git }
    }

    @MainActor
    private static func sessions(_ stage: GalleryStage) async {
      await stage.host.loadSessions(repoRoot: GalleryGit.repoRoot)
    }

    private static var branch: RemoteGitBranch {
      let json = GalleryFixtures.git(sessionId: root)[RemoteMethod.sessionsBranches.rawValue] ?? "{}"
      struct List: Decodable { let branches: [RemoteGitBranch] }
      let list = try? ProtocolCodec.decoder.decode(List.self, from: Data(json.utf8))
      // The fixture is ours; a missing branch is a bug in it.
      return list!.branches.first { $0.name == GalleryGit.branch }!
    }
  }
#endif
