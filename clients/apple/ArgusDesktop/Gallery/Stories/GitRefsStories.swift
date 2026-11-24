#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// GroveUIKit's refs sidebar beside Stashes, Reflog and Branches Review, on a repository with branch folders, two
  /// remotes, tags, a worktree, a submodule, three stashes and merged, stale and active branches; Argus pins
  /// `experiment`, archives `legacy-ui` and protects `main`. Also a worktree session, another colour theme and zoomed.
  enum GitRefsStories {
    static var all: [GalleryStory] {
      [
        story("refs/stashes", view: .stashes),
        story("refs/reflog", view: .reflog),
        story("refs/review", view: .branchesReview),
        story("refs/branch", view: .branches("feature/login")),
        story("refs/worktree-session", view: .stashes, worktree: true),
        story("refs/theme", view: .stashes, colorTheme: .ocean),
        story("refs/zoom", view: .reflog, scale: 17.0 / 13),
        story("refs/filter", view: .branches("feature/login"), filter: "feature"),
      ]
    }

    @MainActor static var workspaces: [String: (GitWorkspace, RemoteSession)] = [:]

    private static func story(
      _ id: String, view: GitRoute, worktree: Bool = false, colorTheme: ColorTheme? = nil, scale: CGFloat = 1,
      filter: String = ""
    ) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 1180, height: 760), chrome: true, fixtures: fixtures, setup: { stage in
        let root = build()
        let path = worktree ? root + "-worktrees/feature-search" : root
        let runner = LocalGitRunner()
        guard let repository = try? await GitRepository(path: URL(fileURLWithPath: path), runner: runner) else { return }
        let session = GalleryFixtures.argusSession(
          "gallery-refs",
          overrides: [
            "id": id, "kind": worktree ? "worktree" : "project_root", "repo_root": root, "path": path,
            "branch": worktree ? "feature/search" : "main", "base_branch": "main",
          ])
        let workspace = GitWorkspace(session: session, repository: repository, runner: runner, host: stage.host)
        workspace.visible = view
        await workspace.refreshAll()
        await workspace.stashes.refresh()
        if let stash = workspace.stashes.stashes.first { await workspace.stashes.select(stash) }
        if let file = workspace.stashes.stashDiffs.first { workspace.stashes.selectFile(file) }
        await workspace.reflog.refresh()
        if workspace.reflog.entries.count > 3 { await workspace.reflog.select(workspace.reflog.entries[3]) }
        await workspace.branchesReview.refresh()
        workspace.refsModel.setExpanded(folder: "local/feature", true)
        workspace.refsModel.setExpanded(folder: "remote/origin", true)
        workspace.refsModel.setSection("archived", expanded: true)
        workspace.refsModel.filter = filter
        await (workspace.visibleHistory ?? workspace.history).loadIfNeeded()
        workspaces[id] = (workspace, session)
      }) {
        RefsStory(id: id, view: view, colorTheme: colorTheme, scale: scale)
      }
    }

    private static var fixtures: [String: String] {
      var fixtures = GalleryFixtures.git(sessionId: GalleryGit.rootSessionId)
      fixtures[ArgusProtocol.Commands.GitListPinnedBranches.name] = GalleryJSON.encode(["experiment"])
      fixtures[ArgusProtocol.Commands.GitListArchivedBranches.name] = GalleryJSON.encode(["legacy-ui"])
      return fixtures
    }

    @MainActor private static func build() -> String {
      let root = GitStories.directory.appendingPathComponent("refs")
      let app = root.appendingPathComponent("app").path
      guard !FileManager.default.fileExists(atPath: app) else { return app }
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/sh")
      process.arguments = ["-c", script, "gallery-refs", root.path]
      try? process.run()
      process.waitUntilExit()
      return app
    }

    static let script = #"""
      set -e
      export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
      mkdir -p "$1"; cd "$1"
      NOW=$(date +%s)
      git init -q --bare origin.git
      git init -q --bare upstream.git
      git init -q -b main lib
      (cd lib && git config user.name Lib && git config user.email lib@example.com && git config commit.gpgsign false \
        && echo lib > README.md && git add -A && git commit -qm "lib")
      git init -q -b main app; cd app
      git config user.name "Maya Chen"; git config user.email maya.chen@example.com
      git config commit.gpgsign false; git config tag.gpgsign false
      git remote add origin ../origin.git; git remote add upstream ../upstream.git
      c() {
        T=$((NOW - $1 * 86400)); printf '%s\n' "$2" >> "${3:-notes.txt}"; git add -A
        GIT_AUTHOR_DATE="@$T +0000" GIT_COMMITTER_DATE="@$T +0000" git commit -q -m "$2"
      }
      c 400 "chore: initial commit"
      c 380 "feat: read the config"
      git tag v1.0
      c 300 "feat: sessions"
      git tag -a v1.1 -m "1.1"
      c 200 "fix: crash on launch"
      git tag v1.2
      git checkout -q -b old/spike; c 220 "spike: try a new renderer" spike.txt; git checkout -q main
      git checkout -q -b legacy-ui; c 190 "legacy: keep the old ui" legacy.txt; git checkout -q main
      git checkout -q -b fix/crash-on-launch; c 60 "fix: guard the window" crash.txt; git checkout -q main
      git merge -q --no-ff fix/crash-on-launch -m "Merge fix/crash-on-launch"
      c 40 "feat: settings window"
      git tag -a v2.0 -m "2.0"
      git checkout -q -b feature/login; c 6 "feat(login): sign in with a passkey" login.txt; c 5 "feat(login): remember the account" login.txt; git checkout -q main
      git checkout -q -b feature/search; c 4 "feat(search): search the history" search.txt; git checkout -q main
      git checkout -q -b feature/settings/theme; c 3 "feat(settings): pick a theme" theme.txt; git checkout -q main
      git checkout -q -b release/2.0; c 2 "chore(release): 2.0" release.txt; git checkout -q main
      git checkout -q -b experiment; c 1 "try: a faster diff" experiment.txt; git checkout -q main
      git checkout -q -b docs; c 1 "docs: explain worktrees" docs.txt; git checkout -q main
      c 1 "perf: read status once"
      git push -q origin main feature/login release/2.0 old/spike --tags 2>/dev/null
      git push -q upstream main 2>/dev/null
      git fetch -q --all
      git branch -q -u origin/main main
      git branch -q -u origin/feature/login feature/login
      c 0 "feat: ahead of origin"
      git -c protocol.file.allow=always submodule add -q ../lib vendor/lib 2>/dev/null
      git add -A; git commit -q -m "chore: vendor lib"
      git worktree add -q ../app-worktrees/feature-search feature/search
      for n in 1 2 3; do
        printf 'change %s\nmore\n' "$n" >> notes.txt; printf 'new file %s\n' "$n" > "draft$n.md"; git add "draft$n.md"
        git stash push -q -m "wip: draft $n"
      done
      git checkout -q feature/login; git checkout -q main
      printf 'local edit\n' >> notes.txt
      """#
  }

  private struct RefsStory: View {
    @Environment(\.theme) private var theme
    let id: String
    let view: GitRoute
    let colorTheme: ColorTheme?
    let scale: CGFloat

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      if let entry = GitRefsStories.workspaces[id] {
        GitWorkspaceView(workspace: entry.0, session: entry.1, view: view)
          .gitUIStyle(.argus(theme, scale: scale))
          .environment(\.theme, theme)
          .tint(theme.tint)
          .background(theme.bg)
      }
    }
  }
#endif
