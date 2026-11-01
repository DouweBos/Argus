import Foundation

/// When the app sidebar gives way so the content beside it keeps its room,
/// as the Mac's window does: hidden while cramped, back once there's space
/// unless the user hid it themselves.
public enum SidebarFit {
  public struct State: Equatable, Sendable {
    public var shown: Bool
    /// Hidden to make room, not by the user.
    public var autoHidden: Bool

    public init(shown: Bool, autoHidden: Bool) {
      self.shown = shown
      self.autoHidden = autoHidden
    }
  }

  public static func fit(_ state: State, cramped: Bool) -> State {
    if cramped, state.shown { return State(shown: false, autoHidden: true) }
    if !cramped, state.autoHidden { return State(shown: true, autoHidden: false) }
    return state
  }

  /// A chat with a side panel beside it, at their minimums, and the sidebar
  /// next to both don't fit in `width`.
  public static func panelCramped(width: Double, sidebar: Double, panel: Double, chat: Double) -> Bool {
    width > 0 && width < sidebar + panel + chat
  }
}
