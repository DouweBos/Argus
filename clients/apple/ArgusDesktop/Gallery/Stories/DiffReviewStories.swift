#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import SwiftUI

  enum DiffReviewStories {
    static let sessionId = "gallery-session"

    static var all: [GalleryStory] {
      [
        GalleryStory("git/diff-review", size: CGSize(width: 900, height: 560), setup: seed) {
          ReviewedDiff(layout: .inline)
        },
        GalleryStory("git/diff-review/split", size: CGSize(width: 1100, height: 560), setup: seed) {
          ReviewedDiff(layout: .split)
        },
        GalleryStory("git/diff-review/composer", size: CGSize(width: 420, height: 0)) {
          DiffCommentComposer(
            title: "Comment on src/session/merge.ts:18-19", submitTitle: "Add Comment",
            text: "Guard against an empty branch name here.", submit: { _ in }, cancel: {})
        },
      ]
    }

    @MainActor
    private static func seed(_ stage: GalleryStage) async {
      let store = stage.model.store
      store.reviews.clear(sessionId)
      for (path, lines, side, excerpt, body) in [
        ("src/session/merge.ts", 18...19, DiffReviewComment.Side.new,
          ["  if (!branch) {", "    throw new Error(\"No branch\")"],
          "Throw a string here: command handlers surface string errors to the client."),
        ("src/session/merge.ts", 12...12, .old, ["  const base = await git.mergeBase(root)"],
          "Why drop the merge base? Squash merges still need it for the conflict check."),
        ("src/git/status.ts", 4...4, .new, ["export const x = 1"], "Rename to something that says what it counts."),
      ] {
        store.reviews.add(
          DiffReviewComment(
            path: path, side: side, lines: lines, excerpt: excerpt, hunk: "", scope: "uncommitted changes", body: body),
          sessionId: sessionId)
      }
    }

    @MainActor static var diff: DiffResult {
      func line(_ id: Int, _ type: DiffLineType, _ text: String, old: Int?, new: Int?) -> GroveKit.DiffLine {
        GroveKit.DiffLine(id: "\(id)", type: type, content: text, oldLineNumber: old, newLineNumber: new)
      }
      let lines = [
        line(1, .context, "export async function merge(root: string, branch: string) {", old: 10, new: 10),
        line(2, .context, "  const git = gitAt(root)", old: 11, new: 11),
        line(3, .deletion, "  const base = await git.mergeBase(root)", old: 12, new: nil),
        line(4, .addition, "  const strategy = await settings.mergeStrategy(root)", old: nil, new: 12),
        line(5, .context, "", old: 13, new: 13),
        line(6, .context, "  for (const hook of hooks) await hook.before(branch)", old: 14, new: 14),
        line(7, .addition, "  log.info(\"merging\", { strategy })", old: nil, new: 15),
        line(8, .context, "", old: 15, new: 16),
        line(9, .context, "  // Nothing to merge is not an error.", old: 16, new: 17),
        line(10, .addition, "  if (!branch) {", old: nil, new: 18),
        line(11, .addition, "    throw new Error(\"No branch\")", old: nil, new: 19),
        line(12, .addition, "  }", old: nil, new: 20),
        line(13, .context, "  return git.merge(branch, { strategy })", old: 17, new: 21),
        line(14, .context, "}", old: 18, new: 22),
      ]
      let hunk = HunkData(
        id: "h1", header: "@@ -10,9 +10,13 @@ export async function merge", oldStart: 10, oldCount: 9, newStart: 10,
        newCount: 13, lines: lines)
      return DiffResult(filePath: "src/session/merge.ts", hunks: [hunk], stats: DiffStats(additions: 5, deletions: 1))
    }
  }

  private struct ReviewedDiff: View {
    @Environment(DesktopModel.self) private var model
    let layout: DiffLayout

    var body: some View {
      VStack(spacing: 0) {
        DiffTableView(
          diff: DiffReviewStories.diff, layout: layout,
          review: DiffReviewContext.session(
            DiffReviewStories.sessionId, path: DiffReviewStories.diff.filePath, scope: "uncommitted changes",
            store: model.store))
        DiffReviewBar(sessionId: DiffReviewStories.sessionId)
      }
    }
  }
#endif
