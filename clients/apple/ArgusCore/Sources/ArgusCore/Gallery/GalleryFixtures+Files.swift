import ArgusKit
import Foundation

/// A worktree's files, and a diff touching a few of them, for Quick Open on both apps.
extension GalleryFixtures {
  static let worktreeFiles = [
    "README.md", "package.json", "tsconfig.json", ".changeset/quick-open.md",
    "src/App.tsx", "src/main.tsx", "src/routes/route.ts", "src/routes/useRoute.ts",
    "src/components/Button/Button.tsx", "src/components/Button/Button.module.css",
    "src/components/Button/Button.stories.tsx", "src/components/QuickOpen/QuickOpen.tsx",
    "src/components/QuickOpen/QuickOpenRow.tsx", "src/components/Sidebar/SessionRow.tsx",
    "src/stores/sessionStore.ts", "src/stores/agentStore.ts", "src/lib/fuzzyMatch.ts",
    "src/lib/fuzzyMatch.test.ts", "packages/host/src/services/file/search.ts",
    "packages/host/src/services/file/listFiles.ts",
    "clients/apple/ArgusDesktop/Code/QuickOpenView.swift",
    "clients/apple/ArgusRemote/Screens/QuickOpenView.swift",
    "clients/apple/ArgusUI/Sources/ArgusUI/Views/FileListRows.swift",
  ]

  public static var files: [String: String] {
    let changed = ["src/components/QuickOpen/QuickOpen.tsx", "src/lib/fuzzyMatch.ts"]
    let diff = changed.map { path in
      "diff --git a/\(path) b/\(path)\n--- a/\(path)\n+++ b/\(path)\n@@ -1,1 +1,1 @@\n-old\n+new\n"
    }.joined()
    return [
      ArgusProtocol.Commands.ListSessionFiles.name: GalleryJSON.encode(worktreeFiles),
      RemoteMethod.sessionsFiles.rawValue: GalleryJSON.encode(["files": worktreeFiles]),
      RemoteMethod.sessionsDiff.rawValue: GalleryJSON.encode(["diff": diff]),
    ]
  }
}
