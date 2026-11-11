import SwiftUI

/// Diagonal stripes for a part of a bar about to change (what a reset gives
/// back). They overshoot the rect, so clip the view drawing them.
public struct HatchStripes: Shape {
  var spacing: CGFloat
  var width: CGFloat

  public init(spacing: CGFloat = 5, width: CGFloat = 2) {
    self.spacing = spacing
    self.width = width
  }

  public func path(in rect: CGRect) -> Path {
    var path = Path()
    var x = rect.minX - rect.height
    while x < rect.maxX {
      path.move(to: CGPoint(x: x, y: rect.maxY))
      path.addLine(to: CGPoint(x: x + rect.height, y: rect.minY))
      x += spacing
    }
    return path.strokedPath(StrokeStyle(lineWidth: width))
  }
}

/// A theme color laid as stripes over a faint wash of itself.
public struct HatchedFill: View {
  let color: Color

  public init(color: Color) {
    self.color = color
  }

  public var body: some View {
    ZStack {
      Rectangle().fill(color.opacity(0.25))
      HatchStripes().fill(color)
    }
    .clipped()
    .accessibilityHidden(true)
  }
}
