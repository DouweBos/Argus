import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// GroveUIKit's diff pane dressed for Argus: its options, code view and review comments.
/// Every git view shows diffs through this.
struct DiffPane: View {
  @Environment(\.theme) private var theme
  let diff: DiffResult?
  var path: String?
  /// Shown in place of the path.
  var title: String?
  var isLoading = false
  var staging: GitDiffStaging?
  var sideSwitch: GitDiffSideSwitch?
  /// "Open in Editor at Line" on the rows: the new side's 1-based line.
  var openLine: (@MainActor @Sendable (Int) -> Void)?
  /// Draft review comments on this file; nil where the diff can't take them.
  var review: DiffReviewContext?
  var ignoreWhitespace: Binding<Bool>?
  /// Where image files are read from; nil where their revisions aren't in the repository.
  var images: GitDiffImages?
  /// Extra controls on the header's trailing side.
  var accessory: AnyView?

  var body: some View {
    let name = path ?? diff?.filePath
    GitDiffPane(
      diff: diff, path: path, title: title, isLoading: isLoading, options: DiffViewSettings.shared.options,
      staging: staging, sideSwitch: sideSwitch, ignoresWhitespace: ignoreWhitespace,
      annotations: review?.annotations(theme: theme), images: images,
      leading: { [name] in
        if let name { FileTypeIcon(path: name) }
      },
      accessory: { [accessory] in
        if let accessory { accessory }
      }
    )
    .gitUIHost(.argus(openLine: openLine))
    .argusGitUI()
  }
}
