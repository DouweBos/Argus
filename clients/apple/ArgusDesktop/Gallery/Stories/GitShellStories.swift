#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// The whole git view, pills and all, on the refs stories' repository: every pill at the narrowest roomy window
  /// (1260) and a wide one (1600), a worktree session's own pills, the tools and the project's pull requests, in
  /// another colour theme and zoomed.
  enum GitShellStories {
    static var all: [GalleryStory] {
      let root: [(String, GitRoute)] = [
        ("changes", .working), ("history", .history), ("stashes", .stashes), ("pull-requests", .pullRequests),
        ("branches-review", .branchesReview),
      ]
      let worktree: [(String, GitRoute)] = [
        ("changes", .working), ("branch", .branch), ("timeline", .timeline(turn: nil)), ("guide", .guide),
        ("stashes", .stashes),
      ]
      let tools: [(String, GitRoute)] = [
        ("settings", .settings), ("hooks", .hooks), ("submodules", .submodules), ("bisect", .bisect),
        ("reflog", .reflog),
      ]
      return [1260, 1600].flatMap { width in root.map { story("shell/\(Int(width))/\($0.0)", view: $0.1, width: width) } }
        + worktree.map { story("shell/worktree/\($0.0)", view: $0.1, width: 1260, worktree: true) }
        + tools.map { story("shell/tools/\($0.0)", view: $0.1, width: 1260) }
        + [
          story("shell/narrow", view: .history, width: 760),
          story("shell/theme", view: .history, width: 1260, colorTheme: .ocean),
          story("shell/zoom", view: .working, width: 1600, scale: 17.0 / 13),
          story("shell/zoom-tools", view: .settings, width: 1260, scale: 17.0 / 13),
        ]
    }

    @MainActor static var workspaces: [String: (GitWorkspace, RemoteSession)] = [:]

    private static func story(
      _ id: String, view: GitRoute, width: CGFloat, worktree: Bool = false, colorTheme: ColorTheme? = nil,
      scale: CGFloat = 1
    ) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: width, height: 800), chrome: true, fixtures: fixtures, setup: { stage in
        let root = GitRefsStories.build()
        let path = worktree ? root + "-worktrees/feature-search" : root
        let runner = LocalGitRunner()
        guard let repository = try? await GitRepository(path: URL(fileURLWithPath: path), runner: runner) else { return }
        let session = GalleryFixtures.argusSession(
          "gallery-shell",
          overrides: [
            "id": id, "kind": worktree ? "worktree" : "project_root",
            // The pull request fixtures' project, so the panel lists them.
            "repo_root": view == .pullRequests ? "/Users/dev/Projects/luma" : root, "path": path,
            "branch": worktree ? "feature/search" : "main", "base_branch": "main",
          ])
        let workspace = GitWorkspace(session: session, repository: repository, runner: runner, host: stage.host)
        workspace.visible = view
        await workspace.refreshAll()
        await workspace.stashes.refresh()
        if let stash = workspace.stashes.stashes.first { await workspace.stashes.select(stash) }
        await workspace.reflog.refresh()
        if let entry = workspace.reflog.entries.first { await workspace.reflog.select(entry) }
        await workspace.branchesReview.refresh()
        if let entry = workspace.workingCopy.statusEntries.first { await workspace.workingCopy.select(entry) }
        await (workspace.visibleHistory ?? workspace.history).loadIfNeeded()
        await stage.model.pullRequests.refresh()
        workspaces[id] = (workspace, session)
      }) {
        ShellStory(id: id, view: view, colorTheme: colorTheme, scale: scale)
      }
    }

    private static var fixtures: [String: String] {
      var fixtures = GalleryFixtures.git(sessionId: GalleryGit.rootSessionId)
        .merging(GalleryFixtures.pullRequests) { git, _ in git }
        .merging(GalleryFixtures.reviewGuide(.ready)) { git, _ in git }
      fixtures[ArgusProtocol.Commands.GitListPinnedBranches.name] = GalleryJSON.encode(["experiment"])
      fixtures[ArgusProtocol.Commands.GitListArchivedBranches.name] = GalleryJSON.encode(["legacy-ui"])
      let config = ["user.name": "Maya Chen", "user.email": "maya.chen@example.com", "pull.rebase": "true",
                    "fetch.prune": "true", "push.autoSetupRemote": "true"]
      fixtures[ArgusProtocol.Commands.GitGetConfig.name] = "null"
      for (key, value) in config {
        fixtures["\(ArgusProtocol.Commands.GitGetConfig.name)?key=\(key)"] = "\"\(value)\""
      }
      fixtures[ArgusProtocol.Commands.GitListRemotes.name] = GalleryJSON.encode([
        ["name": "origin", "fetchUrl": "git@github.com:acme/luma.git", "refs": 4, "scheme": "ssh", "host": "github.com"],
        ["name": "upstream", "fetchUrl": "https://github.com/luma-dev/luma.git", "refs": 1, "scheme": "https",
         "host": "github.com"],
      ])
      fixtures[ArgusProtocol.Commands.GitLfsFiles.name] = GalleryJSON.encode([
        "lfsInstalled": true, "repoUsesLfs": true, "tracked": ["assets/hero.psd", "assets/intro.mov"],
      ])
      let ranAt = Date().addingTimeInterval(-3_600).timeIntervalSince1970 * 1000
      fixtures[ArgusProtocol.Commands.GitListHooks.name] = GalleryJSON.encode([
        ["name": "pre-commit", "path": ".git/hooks/pre-commit", "executable": true, "lastModified": ranAt,
         "lastOutput": ["exitCode": 0, "ranAt": ranAt, "stdout": "eslint: 0 problems\nprettier: 214 files checked\n",
                        "stderr": ""]],
        ["name": "pre-push", "path": ".git/hooks/pre-push", "executable": true, "lastModified": ranAt,
         "lastOutput": ["exitCode": 1, "ranAt": ranAt, "stdout": "", "stderr": "2 tests failed\n"]],
        ["name": "commit-msg", "path": ".git/hooks/commit-msg", "executable": false, "lastModified": ranAt],
      ])
      fixtures[ArgusProtocol.Commands.GitSubmoduleList.name] = GalleryJSON.encode([
        ["name": "vendor/lib", "path": "vendor/lib", "url": "../lib", "commitHash": "4f2a9c1e0b7d", "status": "clean"],
        ["name": "design-tokens", "path": "packages/tokens", "url": "git@github.com:acme/tokens.git",
         "commitHash": "9b1e44d02a6f", "status": "modified"],
        ["name": "docs-theme", "path": "docs/theme", "url": "https://github.com/acme/docs-theme.git",
         "commitHash": "", "status": "uninitialized"],
      ])
      fixtures[ArgusProtocol.Commands.GitBisectStatus.name] = GalleryJSON.encode([
        "active": true, "currentRef": "c3d1f0a9b2e4", "currentSubject": "feat: settings window", "remaining": 3,
        "finished": false,
      ])
      return fixtures
    }
  }

  private struct ShellStory: View {
    @Environment(\.theme) private var theme
    let id: String
    let view: GitRoute
    let colorTheme: ColorTheme?
    let scale: CGFloat

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      if let entry = GitShellStories.workspaces[id] {
        GitScreenStory(workspace: entry.0, session: entry.1, view: view)
          .gitUIStyle(.argus(theme, scale: scale))
          .environment(\.theme, theme)
          .tint(theme.tint)
          .background(theme.bg)
      }
    }
  }

  /// The open repository as `GitScreen` shows it, without reopening it through the host.
  private struct GitScreenStory: View {
    let workspace: GitWorkspace
    let session: RemoteSession
    let view: GitRoute

    var body: some View {
      GitWorkspaceView(workspace: workspace, session: session, view: view)
    }
  }
#endif
