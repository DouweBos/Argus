import SwiftUI

/// The one column a chat reads in: transcript and composer share it, centred
/// on the canvas, and step left of anything floating at the pane's top right.
public enum ReadingColumn {
  /// The text's width at most.
  public static let maxWidth: CGFloat = 700
  /// Kept clear at the pane's edges.
  public static let gutter: CGFloat = 20

  /// Where the column's content sits in a pane `width` wide, clear of the
  /// `reserve` points at its trailing edge when centring would run into them.
  public static func frame(in width: CGFloat, reserve: CGFloat = 0) -> (x: CGFloat, width: CGFloat) {
    let content = max(min(maxWidth, width - gutter * 2), 1)
    let centred = (width - content) / 2
    let limit = width - reserve
    guard reserve > 0, centred + content > limit else { return (centred, content) }
    let room = limit - gutter
    // Too narrow to step aside: overlapping the card beats a sliver of text.
    guard room >= 320 else { return (centred, content) }
    let shifted = min(content, room)
    return (max(gutter, limit - shifted), shifted)
  }
}

extension EnvironmentValues {
  /// Points at the pane's trailing edge the reading column keeps clear of.
  @Entry public var readingColumnReserve: CGFloat = 0
}

/// Lays its content out in the reading column of whatever it's offered.
public struct ReadingColumnLayout: SwiftUI.Layout {
  var reserve: CGFloat

  public init(reserve: CGFloat) {
    self.reserve = reserve
  }

  public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let subview = subviews.first else { return .zero }
    let width = proposal.width ?? ReadingColumn.maxWidth + ReadingColumn.gutter * 2
    let column = ReadingColumn.frame(in: width, reserve: reserve)
    let size = subview.sizeThatFits(ProposedViewSize(width: column.width, height: proposal.height))
    return CGSize(width: width, height: size.height)
  }

  public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard let subview = subviews.first else { return }
    let column = ReadingColumn.frame(in: bounds.width, reserve: reserve)
    subview.place(
      at: CGPoint(x: bounds.minX + column.x, y: bounds.minY), anchor: .topLeading,
      proposal: ProposedViewSize(width: column.width, height: bounds.height))
  }
}

private struct ReadingColumnModifier: ViewModifier {
  @Environment(\.readingColumnReserve) private var reserve

  func body(content: Content) -> some View {
    ReadingColumnLayout(reserve: reserve) { content }
  }
}

/// Up to `fraction` of the width offered, against the trailing edge: a sent message.
public struct TrailingFractionLayout: SwiftUI.Layout {
  var fraction: CGFloat

  public init(fraction: CGFloat) {
    self.fraction = fraction
  }

  public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    guard let subview = subviews.first else { return .zero }
    let size = subview.sizeThatFits(childProposal(proposal))
    return CGSize(width: proposal.width ?? size.width, height: size.height)
  }

  public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard let subview = subviews.first else { return }
    let child = childProposal(ProposedViewSize(width: bounds.width, height: bounds.height))
    let size = subview.sizeThatFits(child)
    subview.place(
      at: CGPoint(x: bounds.maxX - min(size.width, bounds.width), y: bounds.minY), anchor: .topLeading,
      proposal: ProposedViewSize(width: min(size.width, bounds.width), height: nil))
  }

  private func childProposal(_ proposal: ProposedViewSize) -> ProposedViewSize {
    ProposedViewSize(width: proposal.width.map { ($0 * fraction).rounded(.down) }, height: nil)
  }
}

extension View {
  /// In the reading column, clear of the pane's floating card.
  public func readingColumn() -> some View {
    modifier(ReadingColumnModifier())
  }
}
