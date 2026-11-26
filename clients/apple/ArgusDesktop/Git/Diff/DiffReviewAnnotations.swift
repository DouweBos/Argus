import ArgusCore
import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// Review comments as the kit diff's annotations: a card under the lines, the composer in a popover.
extension DiffReviewContext {
  /// AppKit hosts both, so they're handed the theme.
  @MainActor
  func annotations(theme: Theme, extra: [GitDiffAnnotation] = []) -> GitDiffAnnotations {
    GitDiffAnnotations(
      comments.map { annotation($0, theme: theme) } + extra, addTitle: "Add Comment",
      maxWidth: DiffCommentMetrics.maxCardWidth
    ) { picked, close in
      composer(picked, theme: theme, close: close)
    }
  }

  @MainActor
  private func annotation(_ comment: DiffReviewComment, theme: Theme) -> GitDiffAnnotation {
    GitDiffAnnotation(
      id: comment.id.uuidString, side: comment.side == .new ? .new : .old, revision: "\(comment.lines)\u{0}\(comment.body)",
      anchor: { DiffReviewAnchors.anchor(comment, in: $0) },
      height: { DiffCommentMetrics.rowHeight(body: comment.body, width: $0) },
      content: { context in
        DiffCommentCard(
          comment: comment, width: context.width,
          edit: {
            context.presentPopover { close in
              DiffCommentComposer(
                title: "Edit comment on \(comment.location)", submitTitle: "Save", text: comment.body,
                submit: {
                  update(comment.id, $0)
                  close()
                }, cancel: close
              )
              .environment(\.theme, theme)
            }
          },
          delete: { delete(comment.id) }
        )
        .environment(\.theme, theme)
      })
  }

  @MainActor
  private func composer(_ picked: GitDiffPickedLines, theme: Theme, close: @escaping () -> Void) -> AnyView? {
    let side: DiffReviewComment.Side? =
      switch picked.side {
      case .old: .old
      case .new: .new
      case nil: nil
      }
    guard
      let draft = DiffReviewAnchors.draft(
        path: picked.filePath, hunk: picked.hunk, indices: picked.indices, side: side, scope: scope)
    else { return nil }
    return AnyView(
      DiffCommentComposer(
        title: "Comment on \(draft.location)", submitTitle: "Add Comment", text: "",
        submit: {
          var comment = draft
          comment.body = $0
          add(comment)
          close()
        }, cancel: close
      )
      .environment(\.theme, theme))
  }
}
