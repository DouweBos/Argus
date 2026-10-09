import Foundation

/// A window tab's back and forward stacks, as Electron's `tabStore` keeps
/// them: capped, and never holding the same place twice in a row.
struct NavigationHistory: Equatable {
  static let limit = 50

  /// Oldest first; the last entry is where Back goes.
  private(set) var back: [DesktopLocation] = []
  /// Oldest first; the last entry is where Forward goes.
  private(set) var forward: [DesktopLocation] = []

  var canGoBack: Bool { !back.isEmpty }
  var canGoForward: Bool { !forward.isEmpty }

  /// Leaving `current` for somewhere new: it becomes Back, and Forward is gone.
  mutating func leave(_ current: DesktopLocation) {
    if back.last != current { back.append(current) }
    if back.count > Self.limit { back.removeFirst(back.count - Self.limit) }
    forward = []
  }

  /// Now at `current` without a new step: drops a Back or Forward entry that
  /// would only lead to where the window already is.
  mutating func settle(at current: DesktopLocation) {
    while back.last == current { back.removeLast() }
    while forward.last == current { forward.removeLast() }
  }

  /// Where Back goes from `current`, with `current` becoming Forward.
  mutating func goBack(from current: DesktopLocation) -> DesktopLocation? {
    settle(at: current)
    guard let previous = back.popLast() else { return nil }
    forward.append(current)
    if forward.count > Self.limit { forward.removeFirst(forward.count - Self.limit) }
    return previous
  }

  /// Where Forward goes from `current`, with `current` becoming Back.
  mutating func goForward(from current: DesktopLocation) -> DesktopLocation? {
    settle(at: current)
    guard let next = forward.popLast() else { return nil }
    back.append(current)
    if back.count > Self.limit { back.removeFirst(back.count - Self.limit) }
    return next
  }
}
