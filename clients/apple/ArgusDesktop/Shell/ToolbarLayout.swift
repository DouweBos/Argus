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
  /// The session's own icons (panels, toggles, run and share), always shown.
  var sessionToolsWidth: CGFloat = 0

  /// Window edge insets, the gaps between toolbar items and a little air.
  static let margin: CGFloat = 64

  /// Room for a panel's actions between the breadcrumb and the session's icons.
  var panelActionsWidth: CGFloat {
    guard detailWidth > 0 else { return .infinity }
    return max(0, detailWidth - leadingWidth - sessionToolsWidth - Self.margin)
  }
}
