#if DEBUG
  import ArgusCore
  import ArgusUI
  import Foundation
  import SwiftUI

  /// The git panel on `GalleryGit`'s repository, built on disk once per run.
  enum GitStories {
    static let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("argus-gallery-git-\(getpid())")
    static var rootPath: String { directory.appendingPathComponent("luma").path }
    static var worktreePath: String { directory.appendingPathComponent("luma-worktrees/\(GalleryGit.branch)").path }
    private static let screen = CGSize(width: 1180, height: 720)

    static var all: [GalleryStory] {
      [
        panel("git/changes", worktree: true, view: .working),
        panel("git/branch", worktree: true, view: .branch),
        panel("git/branches", worktree: false, view: .branches(nil)),
        panel("git/history", worktree: false, view: .history),
        panel("git/compare", worktree: false, view: .compare(left: "main", right: GalleryGit.branch)),
        panel("git/stashes", worktree: false, view: .stashes),
        GalleryStory(
          "git/pull-requests", size: screen, chrome: true, fixtures: GalleryFixtures.pullRequests, setup: attach
        ) {
          PullRequestsScreen()
        },
        GalleryStory(
          "git/pull-request", size: screen, chrome: true, fixtures: GalleryFixtures.pullRequests, setup: attach
        ) {
          PullRequestDetailScreen(repo: "acme/luma", number: 482)
        },
      ]
    }

    private static func panel(_ id: String, worktree: Bool, view: GitRoute) -> GalleryStory {
      let sessionId = worktree ? GalleryGit.worktreeSessionId : GalleryGit.rootSessionId
      let fixtures = GalleryFixtures.git(sessionId: sessionId, path: worktree ? worktreePath : rootPath)
        .merging(GalleryFixtures.pullRequests) { git, _ in git }
      return GalleryStory(id, size: screen, chrome: true, fixtures: fixtures, setup: { stage in
        await attach(stage)
        await load(stage, sessionId: sessionId, view: view)
      }) {
        GitPanelStory(sessionId: sessionId, view: view)
      }
    }

    /// The git panel and the PR store read through the app's own `HostStore`.
    @MainActor
    private static func attach(_ stage: GalleryStage) async {
      buildRepository()
      await stage.model.store.attach(stage.backend)
      await stage.host.loadSessions(repoRoot: GalleryGit.repoRoot)
    }

    /// Reads the repository before the shot: GroveKit's first refresh outlasts the render's settle.
    @MainActor
    private static func load(_ stage: GalleryStage, sessionId: String, view: GitRoute) async {
      guard let session = stage.host.session(id: sessionId),
        let workspace = await stage.model.git.open(session)
      else { return }
      workspace.visible = view
      await workspace.refreshAll()
      await (workspace.visibleHistory ?? workspace.history).loadIfNeeded()
    }

    @MainActor private static var built = false

    @MainActor
    private static func buildRepository() {
      guard !built else { return }
      built = true
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/sh")
      process.arguments = ["-c", GalleryGit.script, "gallery-git", directory.path]
      try? process.run()
      process.waitUntilExit()
    }
  }

  private struct GitPanelStory: View {
    @Environment(HostStore.self) private var host
    let sessionId: String
    let view: GitRoute

    var body: some View {
      if let session = host.session(id: sessionId) {
        GitScreen(session: session, view: view)
      }
    }
  }
#endif
