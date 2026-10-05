import AppKit
import ArgusUI
import SwiftUI

/// Two panes side by side with a draggable divider. Unlike `HSplitView`, the
/// leading pane gives up width when the window narrows — an NSSplitView keeps
/// its panes as laid out, which pushed the git panel over the app sidebar.
struct ResizableHSplit<Leading: View, Trailing: View>: View {
  @Environment(\.theme) private var theme
  /// Where the leading width is remembered.
  let key: String
  let leadingMin: CGFloat
  let leadingIdeal: CGFloat
  let leadingMax: CGFloat
  let trailingMin: CGFloat
  @ViewBuilder let leading: () -> Leading
  @ViewBuilder let trailing: () -> Trailing

  @AppStorage private var stored: Double
  @State private var total: CGFloat = 0
  @State private var dragStart: CGFloat?

  init(
    key: String, leadingMin: CGFloat, leadingIdeal: CGFloat, leadingMax: CGFloat, trailingMin: CGFloat,
    @ViewBuilder leading: @escaping () -> Leading, @ViewBuilder trailing: @escaping () -> Trailing
  ) {
    self.key = key
    self.leadingMin = leadingMin
    self.leadingIdeal = leadingIdeal
    self.leadingMax = leadingMax
    self.trailingMin = trailingMin
    self.leading = leading
    self.trailing = trailing
    _stored = AppStorage(wrappedValue: Double(leadingIdeal), "split.\(key)")
  }

  private var width: CGFloat {
    Self.leadingWidth(
      stored: CGFloat(stored), total: total, min: leadingMin, max: leadingMax, trailingMin: trailingMin)
  }

  var body: some View {
    HStack(spacing: 0) {
      leading().frame(width: width)
      divider
      trailing().frame(maxWidth: .infinity)
    }
    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { total = $0 }
  }

  private var divider: some View {
    Rectangle()
      .fill(theme.border)
      .frame(width: 1)
      .padding(.horizontal, 3)
      .contentShape(Rectangle())
      .onHover { inside in
        if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
      }
      .gesture(
        DragGesture(minimumDistance: 1)
          .onChanged { value in
            let start = dragStart ?? width
            dragStart = start
            stored = Double(min(max(start + value.translation.width, leadingMin), leadingMax))
          }
          .onEnded { _ in dragStart = nil })
      .accessibilityLabel("Resize")
  }

  /// The remembered width, held between its bounds and squeezed when the
  /// trailing pane would otherwise drop below its minimum.
  static func leadingWidth(
    stored: CGFloat, total: CGFloat, min lower: CGFloat, max upper: CGFloat, trailingMin: CGFloat
  ) -> CGFloat {
    let wanted = Swift.min(Swift.max(stored, lower), upper)
    guard total > 0 else { return wanted }
    let room = total - trailingMin - 7
    return Swift.max(Swift.min(wanted, room), Swift.min(lower, Swift.max(room, 0)))
  }
}
