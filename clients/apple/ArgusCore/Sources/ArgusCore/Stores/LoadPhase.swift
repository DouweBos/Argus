import Foundation

/// What a list screen shows in place of its rows, so "still loading" and
/// "nothing there" never look the same.
public enum LoadPhase: Equatable, Sendable {
  /// No load has answered yet.
  case loading
  /// Nothing to show and the last load failed.
  case failed(String)
  /// A load answered with nothing.
  case empty
  /// Rows to show; a failed refresh behind them is the screen's banner.
  case content

  /// `loaded` is whether a load has settled, `error` the last one's failure.
  /// Rows already on screen always win, so a background refresh never hides them.
  public init(loaded: Bool, error: String?, isEmpty: Bool) {
    if !isEmpty {
      self = .content
    } else if let error {
      self = .failed(error)
    } else {
      self = loaded ? .empty : .loading
    }
  }

  /// The rows are on screen, so any error belongs in a banner over them.
  public var showsContent: Bool { self == .content }
}
