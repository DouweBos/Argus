#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// Blame from GroveUIKit on a 100,000-line file blamed to 41 commits by four authors: the picker, the working tree,
  /// an older revision, before a commit, a file with no earlier revision, a narrow panel, another colour theme and zoomed.
  enum GitBlameStories {
    static var all: [GalleryStory] {
      [
        story("blame/file", path: big),
        story("blame/picker", path: nil),
        story("blame/revision", path: big, ref: "HEAD~20"),
        story("blame/before", path: big, ref: "HEAD~3^"),
        story("blame/no-earlier-revision", path: "src/step.ts", ref: "HEAD~40^"),
        story("blame/narrow", path: big, width: 700),
        story("blame/narrow-picker", path: nil, width: 700),
        story("blame/theme", path: big, colorTheme: .ocean),
        story("blame/zoom", path: big, scale: 17.0 / 13),
      ]
    }

    static let big = "src/Server.swift"

    @MainActor static var workspaces: [String: GitWorkspace] = [:]

    private static func story(
      _ id: String, path: String?, ref: String? = nil, width: CGFloat = 1180, colorTheme: ColorTheme? = nil,
      scale: CGFloat = 1
    ) -> GalleryStory {
      GalleryStory(id, size: CGSize(width: width, height: 720), setup: { stage in
        let root = build()
        let runner = LocalGitRunner()
        guard let repository = try? await GitRepository(path: URL(fileURLWithPath: root), runner: runner) else { return }
        let session = GalleryFixtures.argusSession(
          "gallery-blame", overrides: ["id": id, "kind": "project_root", "repo_root": root, "base_branch": "main"])
        let workspace = GitWorkspace(session: session, repository: repository, runner: runner, host: stage.host)
        await workspace.blame.loadFilesIfNeeded()
        if let path { await workspace.blame.open(file: path, revision: ref) }
        workspaces[id] = workspace
      }) {
        BlameStory(id: id, path: path, ref: ref, colorTheme: colorTheme, scale: scale)
      }
    }

    @MainActor private static func build() -> String {
      let root = GitStories.directory.appendingPathComponent("blame").path
      guard !FileManager.default.fileExists(atPath: root) else { return root }
      let process = Process()
      process.executableURL = URL(fileURLWithPath: "/bin/sh")
      process.arguments = ["-c", script, "gallery-blame", root]
      try? process.run()
      process.waitUntilExit()
      return root
    }

    /// Forty-one rounds, each rewriting its own scattered runs of a 100,000-line file.
    static let script = #"""
      set -e
      export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
      mkdir -p "$1"; cd "$1"
      git init -q -b main .
      git config commit.gpgsign false
      mkdir -p src
      names="Maya_Chen Ravi_Patel Ines_Duarte Tom_Okafor"
      gen() {
        awk -v k="$1" -v prev="$2" 'BEGIN {
          for (i = 1; i <= 100000; i++) {
            g = int(i / (6 + int(i / 211) % 37));
            v = (g * 7919 + int(g / 3) * 104729) % 41;
            if (prev != "" && v != k) { getline line < prev; print line; continue }
            if (prev != "") getline skip < prev;
            if (v > k) { print "    let value" i " = compute(" i ", step: 0)"; continue }
            r = i % 9;
            if (r == 0) print "    // revision " k ": keep line " i " in step with the cache";
            else if (r == 1) print "func handle" i "(_ request: Request) async throws -> Response {";
            else if (r == 2) print "    guard let session = sessions[\"s" i "\"] else { return .notFound }";
            else if (r == 3) print "}";
            else if (r == 4) print "";
            else print "    let value" i " = compute(" i ", step: " k ")";
          }
        }'
      }
      for k in $(seq 0 40); do
        set -- $names; n=$((k % 4 + 1)); eval who=\${$n}
        git config user.name "$(echo $who | tr _ ' ')"; git config user.email "$(echo $who | tr _ . | tr A-Z a-z)@example.com"
        export GIT_AUTHOR_DATE="2025-$(printf %02d $((k / 4 + 1)))-$(printf %02d $((k % 28 + 1)))T10:00:00+0000" GIT_COMMITTER_DATE="$GIT_AUTHOR_DATE"
        if [ $k = 0 ]; then gen 0 "" > src/Server.swift; else gen $k src/Server.swift > next.tmp; mv next.tmp src/Server.swift; fi
        printf 'export const step = %s;\n' $k > src/step.ts
        git add -A; git commit -qm "Rework the request handlers, round $k"
      done
      """#
  }

  private struct BlameStory: View {
    @Environment(\.theme) private var theme
    let id: String
    let path: String?
    let ref: String?
    let colorTheme: ColorTheme?
    let scale: CGFloat

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      if let workspace = GitBlameStories.workspaces[id] {
        BlameView(workspace: workspace, path: path, ref: ref)
          .gitUIStyle(.argus(theme, scale: scale))
          .environment(\.theme, theme)
          .tint(theme.tint)
          .background(theme.bg)
      }
    }
  }
#endif
