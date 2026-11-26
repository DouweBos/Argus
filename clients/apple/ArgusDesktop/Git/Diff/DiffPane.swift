import ArgusCore
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
  /// Who wrote the added lines, by new-side number; only where the new side is the tree as it is now.
  var attribution: [Int: LineAuthor]?
  /// Extra controls on the header's trailing side.
  var accessory: AnyView?

  var body: some View {
    let name = path ?? diff?.filePath
    let marks = attribution.flatMap { $0.isEmpty ? nil : DiffAttribution(marks: $0) }
    let counts = diff.flatMap { diff in marks.map { $0.counts(in: diff) } }.flatMap { $0.isEmpty ? nil : $0 }
    GitDiffPane(
      diff: diff, path: path, title: title, isLoading: isLoading, options: DiffViewSettings.shared.options,
      staging: staging, sideSwitch: sideSwitch, ignoresWhitespace: ignoreWhitespace,
      // The runs ride the review's rows: without a review the kit would offer a + that adds nothing.
      annotations: review?.annotations(
        theme: theme, extra: diff.flatMap { diff in marks?.annotations(in: diff, theme: theme) } ?? []),
      images: images,
      leading: { [name] in
        if let name { FileTypeIcon(path: name) }
      },
      accessory: { [accessory, counts] in
        if let counts { AttributionLegend(counts: counts) }
        if let accessory { accessory }
      }
    )
    .gitUIHost(.argus(openLine: openLine))
    .argusGitUI()
  }
}
