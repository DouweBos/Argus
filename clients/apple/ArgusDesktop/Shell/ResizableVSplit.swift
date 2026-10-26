import AppKit
import ArgusUI
import SwiftUI

/// A pane over an optional bottom panel with a draggable divider. Unlike
/// `VSplitView`, it never holds the width it was first laid out at, so the
/// column it sits in can narrow with the window.
struct ResizableVSplit<Top: View, Bottom: View>: View {
  @Environment(\.theme) private var theme
  let topMin: CGFloat
  let bottomMin: CGFloat
  let showsBottom: Bool
  /// Cards stacked get an empty gap to drag rather than a line.
  var gap: CGFloat?
  @ViewBuilder let top: () -> Top
  @ViewBuilder let bottom: () -> Bottom

  @AppStorage private var stored: Double
  @State private var total: CGFloat = 0
  @State private var dragStart: CGFloat?

  init(
    key: String, topMin: CGFloat, bottomMin: CGFloat, bottomIdeal: CGFloat, showsBottom: Bool, gap: CGFloat? = nil,
    @ViewBuilder top: @escaping () -> Top, @ViewBuilder bottom: @escaping () -> Bottom
  ) {
    self.topMin = topMin
    self.bottomMin = bottomMin
    self.showsBottom = showsBottom
    self.gap = gap
    self.top = top
    self.bottom = bottom
    _stored = AppStorage(wrappedValue: Double(bottomIdeal), "split.\(key)")
  }

  /// The bottom panel's height: what was dragged to, kept clear of the top's minimum.
  private var height: CGFloat {
    ResizableHSplit<EmptyView, EmptyView>.leadingWidth(
      stored: CGFloat(stored), total: total, min: bottomMin, max: .greatestFiniteMagnitude, trailingMin: topMin,
      divider: gap ?? 7)
  }

  var body: some View {
    VStack(spacing: 0) {
      top().frame(maxHeight: .infinity)
      if showsBottom {
        divider
        bottom().frame(height: height)
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { total = $0 }
  }

  private var divider: some View {
    Group {
      if let gap {
        Color.clear.frame(height: gap)
      } else {
        Rectangle().fill(theme.border).frame(height: 1).padding(.vertical, 3)
      }
    }
    .contentShape(Rectangle())
    .onHover { inside in
      if inside { NSCursor.resizeUpDown.push() } else { NSCursor.pop() }
    }
    .gesture(
      DragGesture(minimumDistance: 1)
        .onChanged { value in
          let start = dragStart ?? height
          dragStart = start
          stored = Double(max(start - value.translation.height, bottomMin))
        }
        .onEnded { _ in dragStart = nil })
    .accessibilityLabel("Resize terminal")
  }
}
