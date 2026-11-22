#if DEBUG
  import AppKit
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// The shared diff as Argus dresses it: highlights, wrapping, zoom, another colour theme, images and LFS.
  enum DiffStories {
    static var all: [GalleryStory] {
      [
        story("git/diff/highlights", size: CGSize(width: 980, height: 520)) { StoryDiff() },
        story("git/diff/split", size: CGSize(width: 1180, height: 520)) { StoryDiff(layout: .split, wraps: true) },
        story("git/diff/wrap", size: CGSize(width: 620, height: 600)) { StoryDiff(wraps: true) },
        story("git/diff/narrow", size: CGSize(width: 330, height: 520)) { StoryDiff(wraps: true, staged: true) },
        story("git/diff/zoom", size: CGSize(width: 980, height: 560)) { StoryDiff(scale: 17.0 / 13) },
        story("git/diff/theme", size: CGSize(width: 980, height: 520)) { StoryDiff(colorTheme: .ocean) },
        story("git/diff/lfs", size: CGSize(width: 760, height: 340)) { StoryDiff(diff: parsed(lfsPatch)) },
        story("git/diff/image", size: CGSize(width: 840, height: 420)) { StoryImageDiff() },
      ]
    }

    private static func story(_ id: String, size: CGSize, @ViewBuilder content: @escaping @MainActor () -> some View) -> GalleryStory {
      GalleryStory(id, size: size) { content() }
    }

    @MainActor
    static func parsed(_ patch: String) -> DiffResult? {
      DiffParser.parse(patch).first
    }

    static let patch = """
      diff --git a/Sources/Session/MergeCoordinator.swift b/Sources/Session/MergeCoordinator.swift
      --- a/Sources/Session/MergeCoordinator.swift
      +++ b/Sources/Session/MergeCoordinator.swift
      @@ -12,13 +12,17 @@ struct MergeCoordinator {
           /* Merges a session's branch into
              the project's default branch. */
           func merge(_ branch: String) async throws -> MergeResult {
               let git = Git(root: root)
      -        let base = try await git.mergeBase(branch, with: "main")
      -        log.info("merging")
      +        let strategy = try await settings.mergeStrategy(root, fallback: .squash)
      +        log.info("merging \\(branch)")

               // Nothing to merge is not an error.
      +        guard !branch.isEmpty else {
      +            throw MergeError.noBranch(message: "Pass the branch to merge; an empty name would merge the current branch into itself", code: 42)
      +        }
               for hook in hooks { await hook.before(branch) }
      -        return try await git.merge(branch)
      +        return try await git.merge(branch, strategy: strategy)
           }
       }
      @@ -48,3 +52,3 @@ extension MergeCoordinator {
           var label: String {
      -        "merge-\\(index)"
      +        "merge-\\(index + 1)"
           }

      """

    static let lfsPatch = """
      diff --git a/Assets/onboarding.mov b/Assets/onboarding.mov
      --- a/Assets/onboarding.mov
      +++ b/Assets/onboarding.mov
      @@ -1,3 +1,3 @@
       version https://git-lfs.github.com/spec/v1
      -oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393
      -size 18234981
      +oid sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
      +size 24518203

      """
  }

  private struct StoryDiff: View {
    @Environment(\.theme) private var theme
    var diff: DiffResult? = DiffStories.parsed(DiffStories.patch)
    var layout = GitDiffLayout.inline
    var wraps = false
    var staged = false
    var scale: CGFloat = 1
    var colorTheme: ColorTheme?

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      GitDiffPane(
        diff: diff, options: GitDiffOptions(layout: .constant(layout), wrapsLines: .constant(wraps)),
        staging: GitDiffStaging(side: staged ? .staged : .unstaged) { _, _, _ in },
        sideSwitch: GitDiffSideSwitch(side: staged ? .staged : .unstaged, select: { _ in }),
        ignoresWhitespace: .constant(false),
        leading: { [diff] in
          if let diff { FileTypeIcon(path: diff.filePath) }
        },
        accessory: { EmptyView() }
      )
      .gitUIStyle(.argus(theme, scale: scale))
      .background(theme.bg)
      .environment(\.theme, theme)
    }
  }

  /// Both sides of an image, from a throwaway repository.
  private struct StoryImageDiff: View {
    @Environment(\.theme) private var theme
    @State private var images: GitDiffImages?

    var body: some View {
      Group {
        if let images {
          GitDiffPane(diff: nil, path: "assets/icon.png", options: GitDiffOptions(), images: images)
        } else {
          Color.clear
        }
      }
      .argusGitUI()
      .background(theme.bg)
      .task { images = await load() }
    }

    private func load() async -> GitDiffImages? {
      let root = FileManager.default.temporaryDirectory.appendingPathComponent("argus-gallery-image-\(UUID().uuidString)")
      let file = root.appendingPathComponent("assets/icon.png")
      do {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try png(hue: 0.02).write(to: file)
        for arguments in [
          ["init", "-q"], ["add", "--", "assets/icon.png"],
          ["-c", "user.name=Gallery", "-c", "user.email=gallery@example.com", "-c", "commit.gpgsign=false",
           "-c", "core.hooksPath=/dev/null", "commit", "-qm", "icon"],
        ] {
          let git = Process()
          git.executableURL = URL(fileURLWithPath: "/usr/bin/git")
          git.arguments = ["-C", root.path] + arguments
          try git.run()
          git.waitUntilExit()
        }
        try png(hue: 0.58).write(to: file)
        let repository = try await GitRepository(path: root, runner: LocalGitRunner())
        return GitDiffImages(repository: repository, old: .commit("HEAD"), new: .workingTree)
      } catch {
        return nil
      }
    }

    private func png(hue: CGFloat) -> Data {
      let image = NSImage(size: NSSize(width: 256, height: 256), flipped: false) { rect in
        NSColor(hue: hue, saturation: 0.7, brightness: 0.9, alpha: 1).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 56, yRadius: 56).fill()
        return true
      }
      let bitmap = image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))
      return bitmap?.representation(using: .png, properties: [:]) ?? Data()
    }
  }
#endif
