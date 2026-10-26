import AppKit
import ArgusUI
import SwiftUI

/// Two panes side by side with a draggable divider. Unlike `HSplitView`, the
/// pinned pane gives up width when the window narrows — an NSSplitView keeps
/// its panes as laid out, which pushed the git panel over the app sidebar.
struct ResizableHSplit<Leading: View, Trailing: View>: View {
  @Environment(\.theme) private var theme
  /// The pane with the remembered width; the other takes the rest.
  let pinned: HorizontalEdge
  let pinnedMin: CGFloat
  let pinnedMax: CGFloat
  /// The flexible pane's minimum.
  let otherMin: CGFloat
  /// False hides the pinned pane and its divider; its width is kept for when it's back.
  var showsPinned = true
  /// Cards side by side get an empty gap to drag rather than a line.
  var gap: CGFloat?
  @ViewBuilder let leading: () -> Leading
  @ViewBuilder let trailing: () -> Trailing

  @AppStorage private var stored: Double
  @State private var total: CGFloat = 0
  @State private var dragStart: CGFloat?

  init(
    key: String, leadingMin: CGFloat, leadingIdeal: CGFloat, leadingMax: CGFloat, trailingMin: CGFloat,
    showsLeading: Bool = true, gap: CGFloat? = nil,
    @ViewBuilder leading: @escaping () -> Leading, @ViewBuilder trailing: @escaping () -> Trailing
  ) {
    self.init(
      key: key, pinned: .leading, min: leadingMin, ideal: leadingIdeal, max: leadingMax, otherMin: trailingMin,
      leading: leading, trailing: trailing)
    showsPinned = showsLeading
    self.gap = gap
  }

  init(
    key: String, leadingMin: CGFloat, trailingMin: CGFloat, trailingIdeal: CGFloat, trailingMax: CGFloat,
    showsTrailing: Bool = true,
    @ViewBuilder leading: @escaping () -> Leading, @ViewBuilder trailing: @escaping () -> Trailing
  ) {
    self.init(
      key: key, pinned: .trailing, min: trailingMin, ideal: trailingIdeal, max: trailingMax, otherMin: leadingMin,
      leading: leading, trailing: trailing)
    showsPinned = showsTrailing
  }

  private init(
    key: String, pinned: HorizontalEdge, min: CGFloat, ideal: CGFloat, max: CGFloat, otherMin: CGFloat,
    leading: @escaping () -> Leading, trailing: @escaping () -> Trailing
  ) {
    self.pinned = pinned
    pinnedMin = min
    pinnedMax = max
    self.otherMin = otherMin
    self.leading = leading
    self.trailing = trailing
    _stored = AppStorage(wrappedValue: Double(ideal), "split.\(key)")
  }

  private var width: CGFloat {
    Self.leadingWidth(
      stored: CGFloat(stored), total: total, min: pinnedMin, max: pinnedMax, trailingMin: otherMin,
      divider: gap ?? 7)
  }

  var body: some View {
    HStack(spacing: 0) {
      if pinned == .leading {
        if showsPinned {
          leading().frame(width: width)
          divider
        }
        trailing().frame(maxWidth: .infinity)
      } else {
        leading().frame(maxWidth: .infinity)
        if showsPinned {
          divider
          trailing().frame(width: width)
        }
      }
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { total = $0 }
  }

  private var divider: some View {
    Group {
      if let gap {
        Color.clear.frame(width: gap)
      } else {
        Rectangle().fill(theme.border).frame(width: 1).padding(.horizontal, 3)
      }
    }
    .contentShape(Rectangle())
    .onHover { inside in
      if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
    }
    .gesture(
      DragGesture(minimumDistance: 1)
        .onChanged { value in
          let start = dragStart ?? width
          dragStart = start
          let delta = pinned == .leading ? value.translation.width : -value.translation.width
          stored = Double(min(max(start + delta, pinnedMin), pinnedMax))
        }
        .onEnded { _ in dragStart = nil })
    .accessibilityLabel("Resize")
  }

  /// The remembered width, held between its bounds and squeezed when the
  /// trailing pane would otherwise drop below its minimum.
  static func leadingWidth(
    stored: CGFloat, total: CGFloat, min lower: CGFloat, max upper: CGFloat, trailingMin: CGFloat,
    divider: CGFloat = 7
  ) -> CGFloat {
    let wanted = Swift.min(Swift.max(stored, lower), upper)
    guard total > 0 else { return wanted }
    let room = total - trailingMin - divider
    return Swift.max(Swift.min(wanted, room), Swift.min(lower, Swift.max(room, 0)))
  }
}
