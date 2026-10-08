import AppKit
import SwiftUI

/// The transcript's text selection, which can run across messages. It lives
/// here rather than in the text views: rows are recycled and messages restream,
/// and either would lose a selection a view kept for itself.
///
/// Positions are a message id and an offset into that message's rendered
/// string, so a selection holds while its rows scroll off and come back.
@MainActor
final class TranscriptSelection {
  struct Position: Equatable {
    var unit: String
    var index: Int
  }

  private(set) var anchor: Position?
  private(set) var focus: Position?

  /// Where a message sits in the chat, for ordering units.
  var order: (String) -> Int? = { _ in nil }
  /// A message's whole rendered string, for copying the part that's off screen.
  var text: (String) -> String? = { _ in nil }

  private let views = NSHashTable<TranscriptNSTextView>.weakObjects()

  var isEmpty: Bool { anchor == nil || anchor == focus }
  var spansMessages: Bool { anchor != nil && anchor?.unit != focus?.unit }

  func register(_ view: TranscriptNSTextView) {
    views.add(view)
  }

  func begin(at position: Position) {
    anchor = position
    focus = position
    apply()
  }

  func extend(to position: Position) {
    if anchor == nil { anchor = position }
    focus = position
    apply()
  }

  /// A whole message, as ⌘A in it does.
  func select(unit: String, length: Int) {
    anchor = Position(unit: unit, index: 0)
    focus = Position(unit: unit, index: length)
    apply()
  }

  func clear() {
    guard anchor != nil else { return }
    anchor = nil
    focus = nil
    apply()
  }

  /// The selected range in message `unit`'s string, if any of it is selected.
  func range(in unit: String, length: Int) -> NSRange? {
    guard let (start, end) = ordered, let position = order(unit),
      let first = order(start.unit), let last = order(end.unit), first <= position, position <= last
    else { return nil }
    let from = position == first ? min(start.index, length) : 0
    let to = position == last ? min(end.index, length) : length
    return to > from ? NSRange(location: from, length: to - from) : nil
  }

  /// Every selected message's text, oldest first, a blank line between.
  var selectedText: String? {
    guard let (start, end) = ordered, let first = order(start.unit), let last = order(end.unit) else { return nil }
    let units = units(from: first, through: last, start: start.unit, end: end.unit)
    let pieces = units.compactMap { unit -> String? in
      guard let string = text(unit) as NSString?, let range = range(in: unit, length: string.length) else {
        return nil
      }
      return string.substring(with: range)
    }
    let joined = pieces.joined(separator: "\n\n")
    return joined.isEmpty ? nil : TranscriptNSTextView.clipboardText(joined)
  }

  /// Units between two ends. `unitsBetween` comes from the table, which knows
  /// every message, not just the ones with a view on screen.
  var unitsBetween: (Int, Int) -> [String] = { _, _ in [] }

  private func units(from first: Int, through last: Int, start: String, end: String) -> [String] {
    let between = unitsBetween(first, last)
    return between.isEmpty ? (start == end ? [start] : [start, end]) : between
  }

  private var ordered: (Position, Position)? {
    guard let anchor, let focus, anchor != focus, let a = order(anchor.unit), let b = order(focus.unit) else {
      return nil
    }
    return (a, anchor.index) <= (b, focus.index) ? (anchor, focus) : (focus, anchor)
  }

  /// Every text view on screen shows its share.
  func apply() {
    for view in views.allObjects { view.showSelection() }
  }

  // MARK: Hit testing

  /// The selectable position under a window point: the text under it, else
  /// the end of the nearest message above (or the start of the first below).
  func position(at point: NSPoint, in window: NSWindow) -> Position? {
    let candidates = views.allObjects.filter { $0.window === window && $0.unit != nil && !$0.isHiddenOrHasHiddenAncestor }
      .map { view -> (TranscriptNSTextView, NSRect) in (view, view.convert(view.bounds, to: nil)) }
      .filter { $0.0.visibleRect.height > 0 }
      // Window coordinates grow upward: the topmost view first.
      .sorted { $0.1.maxY > $1.1.maxY }
    guard !candidates.isEmpty else { return nil }
    for (view, frame) in candidates where point.y <= frame.maxY && point.y >= frame.minY {
      return view.position(atWindowPoint: point)
    }
    if let above = candidates.last(where: { $0.1.minY > point.y }) {
      return above.0.endPosition
    }
    return candidates.first?.0.startPosition
  }
}

extension EnvironmentValues {
  @Entry var transcriptSelection: TranscriptSelection?
}
