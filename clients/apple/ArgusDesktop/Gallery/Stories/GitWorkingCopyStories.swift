#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// GroveUIKit's working copy and conflicts as Argus shows them: a merge stopped on two text files and a
  /// binary one, its result unreadable over a paired host, the composer narrow, in another colour theme and zoomed.
  enum GitWorkingCopyStories {
    private static let screen = CGSize(width: 1180, height: 720)

    static var all: [GalleryStory] {
      [
        story("git/conflicts", file: "src/session/merge.ts", view: .conflicts),
        story("git/conflicts/binary", file: "assets/logo.png", view: .conflicts),
        story("git/conflicts/remote-unreadable", file: "src/session/merge.ts", view: .conflicts, remote: true),
        story("git/conflicts/zoom", file: "src/session/merge.ts", view: .conflicts, scale: 17.0 / 13),
        story("git/changes/operation", file: "src/session/merge.ts", view: .working),
        story("git/changes/operation-compact", file: nil, view: .working, size: CGSize(width: 760, height: 720)),
        story("git/changes/theme", file: nil, view: .working, conflicted: false, colorTheme: .ocean),
        story("git/changes/zoom", file: nil, view: .working, conflicted: false, scale: 17.0 / 13),
        story("git/changes/compact", file: nil, view: .working, conflicted: false, size: CGSize(width: 820, height: 720)),
      ]
    }

    @MainActor static var workspaces: [String: GitWorkspace] = [:]

    private static func story(
      _ id: String, file: String?, view: GitRoute, conflicted: Bool = true, remote: Bool = false,
      colorTheme: ColorTheme? = nil, scale: CGFloat = 1, size: CGSize = screen
    ) -> GalleryStory {
      GalleryStory(id, size: size, setup: { stage in
        let path = build(conflicted: conflicted)
        let local = LocalGitRunner()
        let runner: any GitRunner = remote ? FarHostRunner(git: local) : local
        guard let repository = try? await GitRepository(path: URL(fileURLWithPath: path), runner: runner) else { return }
        let session = GalleryFixtures.argusSession(
          "gallery-working-copy", overrides: ["id": id, "kind": "project_root", "repo_root": path])
        let workspace = GitWorkspace(session: session, repository: repository, runner: runner, host: stage.host, isRemote: remote)
        workspace.visible = view
        await workspace.workingCopy.refresh()
        if let file, let entry = workspace.workingCopy.statusEntries.first(where: { $0.path == file }) {
          await workspace.workingCopy.select(entry)
        } else if !conflicted, let entry = workspace.workingCopy.stagedFiles.first {
          await workspace.workingCopy.select(entry)
        }
        if !conflicted { workspace.workingCopy.commitSubject = "Pick the merge strategy per session" }
        workspaces[id] = workspace
      }) {
        WorkingCopyStory(id: id, view: view, colorTheme: colorTheme, scale: scale)
      }
    }

    /// A project whose merge stopped on conflicts, or that has staged and unstaged changes; one per kind per run.
    @MainActor private static func build(conflicted: Bool) -> String {
      let root = GitStories.directory.appendingPathComponent(conflicted ? "conflicts" : "changes").path
      guard !FileManager.default.fileExists(atPath: root) else { return root }
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/sh")
      process.arguments = ["-c", conflicted ? conflictScript : changesScript, "gallery-working-copy", root]
      try? process.run()
      process.waitUntilExit()
      return root
    }

    private static let setup = #"""
      set -e
      export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
      mkdir -p "$1"; cd "$1"
      git init -q -b main .
      git config user.name "Maya Chen"; git config user.email maya.chen@example.com; git config commit.gpgsign false
      mkdir -p src/session assets docs
      printf 'export function pickStrategy(session) {\n  return session.strategy ?? "merge";\n}\n' > src/session/merge.ts
      printf 'export const timeout = 30;\n' > src/session/config.ts
      printf 'PNG\000base' > assets/logo.png
      printf '# Luma\n' > docs/README.md
      git add -A; git commit -qm "Add the session merge"
      """#

    private static let conflictScript = setup + #"""

      git switch -qc feat/rebase-default
      printf 'export function pickStrategy(session) {\n  return session.strategy ?? "rebase";\n}\n' > src/session/merge.ts
      printf 'export const timeout = 60;\n' > src/session/config.ts
      printf 'PNG\000theirs' > assets/logo.png
      git commit -qam "Rebase by default"
      git switch -q main
      printf 'export function pickStrategy(session, base) {\n  return session.strategy ?? base.strategy;\n}\n' > src/session/merge.ts
      printf 'export const timeout = 45;\n' > src/session/config.ts
      printf 'PNG\000ours' > assets/logo.png
      printf '# Luma\n\nMerging sessions.\n' > docs/README.md
      git commit -qam "Follow the base's strategy"
      git merge feat/rebase-default >/dev/null 2>&1 || true
      """#

    private static let changesScript = setup + #"""

      printf 'export function pickStrategy(session, base) {\n  return session.strategy ?? base.strategy;\n}\n' > src/session/merge.ts
      git add src/session/merge.ts
      printf 'export const timeout = 45;\n' > src/session/config.ts
      printf '# Luma\n\nMerging sessions.\n' > docs/README.md
      printf 'export const strategies = ["merge", "rebase"];\n' > src/session/strategies.ts
      """#
  }

  /// A paired host's runner as this Mac sees it: git runs, but the worktree's files can't be read here.
  private struct FarHostRunner: GitRunner {
    let git: LocalGitRunner
    var temporaryDirectory: URL { git.temporaryDirectory }

    func run(_ invocation: GitInvocation) async throws -> ShellResult { try await git.run(invocation) }
    func runStreaming(_ invocation: GitInvocation, onStderr: @escaping @Sendable (String) -> Void) async throws
      -> ShellResult
    { try await git.runStreaming(invocation, onStderr: onStderr) }
    func itemKind(at url: URL) async -> FileItemKind? { await git.itemKind(at: url) }
    func readFile(at url: URL) async throws -> Data {
      throw GatewayFailure(message: "The host couldn't send the file: the connection to the paired Mac dropped.")
    }
    func writeFile(_ data: Data, to url: URL, executable: Bool) async throws {}
    func removeItem(at url: URL) async throws {}
    func createDirectory(at url: URL) async throws {}
    func moveItem(at source: URL, to destination: URL) async throws {}
    func contentsOfDirectory(at url: URL) async throws -> [String] { try await git.contentsOfDirectory(at: url) }
  }

  private struct GatewayFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  private struct WorkingCopyStory: View {
    @Environment(HostStore.self) private var host
    @Environment(\.theme) private var theme
    let id: String
    let view: GitRoute
    let colorTheme: ColorTheme?
    let scale: CGFloat

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      if let workspace = GitWorkingCopyStories.workspaces[id] {
        let session = GalleryFixtures.argusSession("gallery-working-copy", overrides: ["id": id, "kind": "project_root"])
        Group {
          if view == .conflicts {
            ConflictsView(workspace: workspace, session: session)
          } else {
            WorkingCopyView(workspace: workspace, session: session)
          }
        }
        .gitUIStyle(.argus(theme, scale: scale))
        .environment(\.theme, theme)
        .tint(theme.tint)
        .background(theme.bg)
      }
    }
  }
#endif
