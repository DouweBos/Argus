#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// The side panel's Diff tab: GroveUIKit's compact working copy with Argus's scope, viewed marks and review,
  /// over a merge stopped on a conflict with staged, unstaged and Git LFS files; narrow and wide, in another colour
  /// theme, zoomed, on the last turn, and the git view narrower than its two columns.
  enum GitCompactStories {
    static var all: [GalleryStory] {
      [
        story("panel/diff/280", width: 280),
        story("panel/diff/420", width: 420),
        story("panel/diff/conflict", width: 420, file: "src/session/merge.ts"),
        story("panel/diff/nothing-picked", width: 280, file: nil),
        story("panel/diff/theme", width: 420, colorTheme: .ocean),
        story("panel/diff/zoom", width: 420, scale: 17.0 / 13),
        story("panel/diff/git-narrow", width: 600, gitView: true),
        lastTurn("panel/diff/last-turn", width: 280),
        lastTurn("panel/diff/last-turn-wide", width: 420),
      ]
    }

    @MainActor static var workspaces: [String: GitWorkspace] = [:]

    private static func story(
      _ id: String, width: CGFloat, file: String? = "src/session/config.ts", colorTheme: ColorTheme? = nil,
      scale: CGFloat = 1, gitView: Bool = false
    ) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: width, height: 720), setup: { stage in
        let path = build()
        let runner = LocalGitRunner()
        guard let repository = try? await GitRepository(path: URL(fileURLWithPath: path), runner: runner) else { return }
        let workspace = GitWorkspace(session: session(id, path: path), repository: repository, runner: runner, host: stage.host)
        await workspace.workingCopy.refresh()
        if let file, let entry = workspace.workingCopy.statusEntries.first(where: { $0.path == file }) {
          await workspace.workingCopy.select(entry)
        }
        workspace.workingCopy.commitSubject = "Pick the merge strategy per session"
        workspaces[id] = workspace
      }) {
        CompactStory(id: id, session: session(id, path: ""), colorTheme: colorTheme, scale: scale, gitView: gitView)
      }
    }

    /// The gallery's session worktree on its last agent turn, which the host names.
    private static func lastTurn(_ id: String, width: CGFloat) -> GalleryStory {
      let sessionId = GalleryGit.worktreeSessionId
      return GalleryStory(
        id, size: CGSize(width: width, height: 720),
        fixtures: GalleryFixtures.git(sessionId: sessionId, path: GitStories.worktreePath),
        setup: { stage in
          await GitStories.attach(stage)
          guard let session = stage.host.session(id: sessionId), let workspace = await stage.model.git.open(session)
          else { return }
          await workspace.refreshAll()
          workspace.scopedDiff.scope = .lastTurn
          await workspace.scopedDiff.load()
          workspace.scopedDiff.selected = workspace.scopedDiff.files.first?.path
          workspaces[id] = workspace
        }
      ) {
        LastTurnStory(id: id, sessionId: sessionId)
      }
    }

    private static func session(_ id: String, path: String) -> RemoteSession {
      GalleryFixtures.argusSession("gallery-compact", overrides: ["id": id, "kind": "project_root", "repo_root": path])
    }

    @MainActor private static func build() -> String {
      let root = GitStories.directory.appendingPathComponent("compact").path
      guard !FileManager.default.fileExists(atPath: root) else { return root }
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/sh")
      process.arguments = ["-c", script, "gallery-compact", root]
      try? process.run()
      process.waitUntilExit()
      return root
    }

    static let script = #"""
      set -e
      export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
      mkdir -p "$1"; cd "$1"
      git init -q -b main .
      git config user.name "Maya Chen"; git config user.email maya.chen@example.com; git config commit.gpgsign false
      mkdir -p src/session src/terminal assets docs
      printf '*.png filter=lfs diff=lfs merge=lfs -text\n' > .gitattributes
      printf 'export function pickStrategy(session) {\n  return session.strategy ?? "merge";\n}\n' > src/session/merge.ts
      printf 'export const timeout = 30;\nexport const retries = 2;\n' > src/session/config.ts
      printf 'export function openShell(cwd) {\n  return spawn(cwd);\n}\n' > src/terminal/pty.ts
      printf '# Luma\n' > docs/README.md
      git add -A; git commit -qm "Add the session merge"
      git switch -qc feat/rebase-default
      printf 'export function pickStrategy(session) {\n  return session.strategy ?? "rebase";\n}\n' > src/session/merge.ts
      printf 'export const timeout = 60;\nexport const retries = 3;\n' > src/session/config.ts
      git commit -qam "Rebase by default"
      git switch -q main
      printf 'export function pickStrategy(session, base) {\n  return session.strategy ?? base.strategy;\n}\n' > src/session/merge.ts
      git commit -qam "Follow the base's strategy"
      git merge feat/rebase-default >/dev/null 2>&1 || true
      printf 'export function openShell(cwd, env) {\n  return spawn(cwd, { env });\n}\n' > src/terminal/pty.ts
      printf '# Luma\n\nMerging sessions.\n' > docs/README.md
      printf 'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\nsize 48213\n' > assets/hero.png
      printf 'export const strategies = ["merge", "rebase"];\n' > src/session/strategies.ts
      """#
  }

  private struct CompactStory: View {
    @Environment(\.theme) private var theme
    let id: String
    let session: RemoteSession
    let colorTheme: ColorTheme?
    let scale: CGFloat
    let gitView: Bool

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      if let workspace = GitCompactStories.workspaces[id] {
        Group {
          if gitView {
            WorkingCopyView(workspace: workspace, session: session)
          } else {
            SessionDiffPanel(workspace: workspace, session: session)
          }
        }
        .gitUIStyle(.argus(theme, scale: scale))
        .environment(\.theme, theme)
        .tint(theme.tint)
        .background(theme.bg)
      }
    }
  }

  private struct LastTurnStory: View {
    @Environment(HostStore.self) private var host
    let id: String
    let sessionId: String

    var body: some View {
      if let workspace = GitCompactStories.workspaces[id], let session = host.session(id: sessionId) {
        SessionDiffPanel(workspace: workspace, session: session).argusGitUI()
      }
    }
  }
#endif
