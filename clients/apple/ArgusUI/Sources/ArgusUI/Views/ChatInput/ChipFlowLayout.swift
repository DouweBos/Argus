import SwiftUI

/// Lays chips out left to right and wraps onto a new line when they run out of
/// room, so a row of chips never asks its column for more width than it has.
struct ChipFlowLayout: SwiftUI.Layout {
  var spacing: CGFloat = 6
  var lineSpacing: CGFloat = 4

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = Self.rows(
      sizes: subviews.map { $0.sizeThatFits(.unspecified) },
      width: proposal.width ?? .infinity, spacing: spacing)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + lineSpacing * CGFloat(max(rows.count - 1, 0))
    return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
  }

  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
    var y = bounds.minY
    for row in Self.rows(sizes: sizes, width: bounds.width, spacing: spacing) {
      var x = bounds.minX
      for index in row.indices {
        let size = sizes[index]
        // Wider than the whole row: shrink it to fit rather than overflow.
        let width = min(size.width, bounds.width)
        subviews[index].place(
          at: CGPoint(x: x, y: y + (row.height - size.height) / 2),
          proposal: ProposedViewSize(width: width, height: size.height))
        x += width + spacing
      }
      y += row.height + lineSpacing
    }
  }

  struct Row: Equatable {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  /// Greedy line breaking: each item goes on the current row while it fits.
  static func rows(sizes: [CGSize], width: CGFloat, spacing: CGFloat) -> [Row] {
    var rows: [Row] = []
    var current = Row()
    for (index, size) in sizes.enumerated() {
      let itemWidth = min(size.width, width)
      let needed = current.indices.isEmpty ? itemWidth : current.width + spacing + itemWidth
      if needed > width, !current.indices.isEmpty {
        rows.append(current)
        current = Row()
      }
      current.width = current.indices.isEmpty ? itemWidth : current.width + spacing + itemWidth
      current.height = max(current.height, size.height)
      current.indices.append(index)
    }
    if !current.indices.isEmpty { rows.append(current) }
    return rows
  }
}
