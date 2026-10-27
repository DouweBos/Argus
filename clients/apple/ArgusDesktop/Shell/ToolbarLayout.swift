import ArgusUI
import CoreGraphics
import Observation

/// What the session toolbar measures, so a panel's own actions (the git
/// panel's) take the room between the breadcrumb and the session's icons and
/// overflow into a More menu rather than push them aside.
@MainActor
@Observable
final class ToolbarLayout {
  /// The detail column the toolbar spans.
  var detailWidth: CGFloat = 0
  /// The breadcrumb at the leading edge.
  var leadingWidth: CGFloat = 0
  /// Each capsule of the session's own icons (panels, toggles, run and share), by slot.
  var sessionGroupWidths: [Int: CGFloat] = [:]

  /// The session's icons, always shown, with the gap the toolbar puts between capsules.
  var sessionToolsWidth: CGFloat {
    let shown = sessionGroupWidths.values.filter { $0 > 0 }
    return shown.reduce(0, +) + CGFloat(max(shown.count - 1, 0)) * Self.groupGap
  }

  static let groupGap: CGFloat = 10

  /// Window edge insets, the gaps between toolbar items and a little air.
  static let margin: CGFloat = 64

  /// Room for a panel's actions between the breadcrumb and the session's icons.
  var panelActionsWidth: CGFloat {
    guard detailWidth > 0 else { return .infinity }
    return max(0, detailWidth - leadingWidth - sessionToolsWidth - Self.margin)
  }
}
