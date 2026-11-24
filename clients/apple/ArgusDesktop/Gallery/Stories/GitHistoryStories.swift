#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// History from GroveUIKit on a repository with six parallel branches merged back, tags and several authors:
  /// a selected commit's changeset and tree, several commits, the table layout, compare, file history, the rebase
  /// planner and a worktree session's branch over its base, in another colour theme and zoomed.
  enum GitHistoryStories {
    static var all: [GalleryStory] {
      [
        story("history/graph") { $0.history.select(commit($0, "Wire the strategy picker")) },
        story("history/changeset") { workspace in
          let vm = workspace.history
          vm.select(commit(workspace, "Merge feat/picker"))
          await waitForDiff(vm)
          vm.select(commit(workspace, "Wire the strategy picker"))
          await waitForDiff(vm)
          vm.setAllFilesExpanded(true)
        },
        story("history/tree") { workspace in
          workspace.history.select(commit(workspace, "Wire the strategy picker"))
          workspace.history.selectDetailTab(.tree)
          try? await Task.sleep(for: .milliseconds(300))
        },
        story("history/multi") { workspace in
          let vm = workspace.history
          vm.select(vm.commits[1])
          vm.click(vm.commits[4], extend: true, toggle: false)
        },
        story("history/table") { workspace in
          workspace.history.setLayout(.table)
          workspace.history.select(workspace.history.commits[2])
        },
        story("history/theme", colorTheme: .ocean) { $0.history.select($0.history.commits[3]) },
        story("history/zoom", scale: 17.0 / 13) { $0.history.select($0.history.commits[3]) },
        story("history/compare", view: .compare) { _ in },
        story("history/file-history", view: .fileHistory) { _ in },
        story("history/rebase", view: .rebase) { _ in },
        story("history/worktree-branch", view: .branch, worktree: true) { _ in },
      ]
    }

    enum Shown { case history, compare, fileHistory, rebase, branch }

    @MainActor static var workspaces: [String: GitWorkspace] = [:]
    @MainActor static var fileHistories: [String: FileHistoryViewModel] = [:]

    private static func story(
      _ id: String, view: Shown = .history, worktree: Bool = false, colorTheme: ColorTheme? = nil, scale: CGFloat = 1,
      prepare: @escaping @MainActor (GitWorkspace) async -> Void
    ) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: 1180, height: 720), setup: { stage in
        let path = build()
        let runner = LocalGitRunner()
        guard let repository = try? await GitRepository(path: URL(fileURLWithPath: path), runner: runner) else { return }
        let workspace = GitWorkspace(
          session: session(id, path: path, worktree: worktree), repository: repository, runner: runner, host: stage.host)
        // Every commit row reads the refs, so they're in before the shot.
        await workspace.refs.refresh()
        await workspace.history.loadInitial()
        workspace.history.setLayout(.graph)
        await prepare(workspace)
        await waitForDiff(workspace.history)
        if view == .fileHistory {
          let history = workspace.history.fileHistory(path: "src/session/merge.ts")
          await history.loadHistory()
          fileHistories[id] = history
        }
        workspaces[id] = workspace
      }) {
        HistoryStory(id: id, shown: view, colorTheme: colorTheme, scale: scale)
      }
    }

    @MainActor private static func commit(_ workspace: GitWorkspace, _ summary: String) -> CommitInfo {
      workspace.history.commits.first { $0.summary == summary } ?? workspace.history.commits[0]
    }

    @MainActor private static func waitForDiff(_ vm: HistoryViewModel) async {
      for _ in 0..<100 where vm.isLoadingDiff { try? await Task.sleep(for: .milliseconds(20)) }
    }

    private static func session(_ id: String, path: String, worktree: Bool) -> RemoteSession {
      GalleryFixtures.argusSession(
        "gallery-history",
        overrides: ["id": id, "kind": worktree ? "worktree" : "project_root", "repo_root": path, "base_branch": "main"])
    }

    @MainActor private static func build() -> String {
      let root = GitStories.directory.appendingPathComponent("history").path
      guard !FileManager.default.fileExists(atPath: root) else { return root }
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/sh")
      process.arguments = ["-c", script, "gallery-history", root]
      try? process.run()
      process.waitUntilExit()
      return root
    }

    /// Six branches worked on side by side and merged back one by one, so the graph runs many lanes.
    static let script = #"""
      set -e
      export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
      mkdir -p "$1"; cd "$1"
      git init -q -b main .
      git config commit.gpgsign false
      who() { git config user.name "$1"; git config user.email "$2"; }
      day=0
      at() {
        day=$((day + 1))
        export GIT_AUTHOR_DATE="2026-10-$(printf %02d $(( (day / 6) + 1 )))T1$((day % 6)):00:00+0000"
        export GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
      }
      mkdir -p src/session src/terminal docs
      who "Maya Chen" maya.chen@example.com; at
      printf 'export function pickStrategy(session) {\n  return session.strategy ?? "merge";\n}\n' > src/session/merge.ts
      printf 'export const timeout = 30;\n' > src/session/config.ts
      printf '# Luma\n' > docs/README.md
      git add -A; git commit -qm "Add the session merge"
      git tag -a v0.1.0 -m "First release"
      for b in picker shell docs retry theme cache; do git branch "feat/$b"; done
      n=0
      for round in 1 2 3; do
        for b in picker shell docs retry theme cache; do
          n=$((n + 1)); at
          case $b in
            picker) who "Maya Chen" maya.chen@example.com ;;
            shell) who "Ravi Patel" ravi@example.com ;;
            docs) who "Ines Duarte" ines@example.com ;;
            *) who "Tom Okafor" tom@example.com ;;
          esac
          git switch -q "feat/$b"
          mkdir -p "src/$b"
          printf 'export const step%s = %s;\n' "$n" "$round" >> "src/$b/index.ts"
          if [ $b = picker ] && [ $round = 2 ]; then
            printf 'export function pickStrategy(session, base) {\n  return session.strategy ?? base.strategy ?? "merge";\n}\n' > src/session/merge.ts
            printf 'export const timeout = 60;\nexport const retries = 3;\n' > src/session/config.ts
            git add -A; git commit -qm "Wire the strategy picker"
          else
            git add -A; git commit -qm "$(printf 'Work on %s, step %s' $b $round)"
          fi
        done
      done
      who "Maya Chen" maya.chen@example.com
      git switch -q main
      for b in docs picker shell; do at; git merge -q --no-ff "feat/$b" -m "Merge feat/$b"; done
      at; printf 'export const timeout = 45;\nexport const retries = 3;\n' > src/session/config.ts
      git commit -qam "Tune the session timeout"
      git tag v0.2.0
      at; git merge -q --no-ff feat/retry -m "Merge feat/retry"
      git switch -q feat/theme
      at; printf '# Theme\n' > docs/theme.md; git add -A; git commit -qm "Document the theme"
      git switch -q main
      at; printf '# Luma\n\nMerging sessions.\n' > docs/README.md; git commit -qam "Explain merging in the README"
      who "Ravi Patel" ravi@example.com
      at; printf 'export const log = true;\n' >> src/session/config.ts; git commit -qam "Log the merge strategy"
      at; printf 'export const label = "Strategy";\n' >> src/picker/index.ts; git commit -qam "Label the strategy picker"
      """#
  }

  private struct HistoryStory: View {
    @Environment(\.theme) private var theme
    let id: String
    let shown: GitHistoryStories.Shown
    let colorTheme: ColorTheme?
    let scale: CGFloat

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      if let workspace = GitHistoryStories.workspaces[id] {
        content(workspace)
          .gitUIStyle(.argus(theme, scale: scale))
          .environment(\.theme, theme)
          .tint(theme.tint)
          .background(theme.bg)
      }
    }

    @ViewBuilder
    private func content(_ workspace: GitWorkspace) -> some View {
      switch shown {
      case .history:
        HistoryScreen(workspace: workspace, history: workspace.history, ref: nil, baseBranch: nil)
      case .branch:
        HistoryScreen(workspace: workspace, history: workspace.history, ref: nil, baseBranch: "feat/picker")
      case .compare:
        CompareView(workspace: workspace, left: "main", right: "feat/theme")
      case .fileHistory:
        if let history = GitHistoryStories.fileHistories[id] {
          GitFileHistoryView(viewModel: history).padding(12).gitFeatures(workspace.features)
        }
      case .rebase:
        InteractiveRebaseView(
          workspace: workspace,
          from: workspace.history.commits.first { $0.summary == "Merge feat/retry" }?.id ?? workspace.history.commits[3].id)
      }
    }
  }
#endif
