import ArgusUI
import CoreGraphics
import Observation

/// What the session toolbar measures, so the view switcher keeps its place:
/// the toolbar centres it over the detail column and only moves it when the
/// items beside it run into it, so the panel's own actions take the room
/// that's left and overflow into a More menu rather than push it aside.
@MainActor
@Observable
final class ToolbarLayout {
  /// The detail column the toolbar's centred item is centred over.
  var detailWidth: CGFloat = 0
  var switcherWidth: CGFloat = 0
  /// The session's own controls (share, run, terminal, device), always shown.
  var sessionToolsWidth: CGFloat = 0

  /// Window edge inset, the gaps between toolbar items and a little air.
  static let margin: CGFloat = 44

  /// Room for a panel's actions between the switcher and the session's controls.
  var panelActionsWidth: CGFloat {
    guard detailWidth > 0 else { return .infinity }
    return max(0, detailWidth / 2 - switcherWidth / 2 - sessionToolsWidth - Self.margin)
  }
}
