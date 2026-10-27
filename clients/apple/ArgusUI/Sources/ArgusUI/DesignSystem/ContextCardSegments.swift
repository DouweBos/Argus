import SwiftUI

/// One segment of a `ContextCardSegments`.
public struct ContextCardSegment<ID: Hashable>: Identifiable {
  public var id: ID
  public var title: String
  public var symbol: String
  public var help: String

  public init(id: ID, title: String, symbol: String, help: String? = nil) {
    self.id = id
    self.title = title
    self.symbol = symbol
    self.help = help ?? title
  }
}

/// A context card's view switcher: equal segments, the one on screen filled
/// quietly, with room for a trailing control such as the card's collapse chevron.
public struct ContextCardSegments<ID: Hashable, Trailing: View>: View {
  let segments: [ContextCardSegment<ID>]
  let selection: ID?
  let onSelect: (ID) -> Void
  let trailing: Trailing

  public init(
    segments: [ContextCardSegment<ID>], selection: ID?, onSelect: @escaping (ID) -> Void,
    @ViewBuilder trailing: () -> Trailing
  ) {
    self.segments = segments
    self.selection = selection
    self.onSelect = onSelect
    self.trailing = trailing()
  }

  public var body: some View {
    HStack(spacing: 2) {
      ForEach(segments) { segment in
        let selected = segment.id == selection
        Button {
          onSelect(segment.id)
        } label: {
          Label(segment.title, systemImage: segment.symbol)
            .labelStyle(.titleAndIcon)
            .font(.scaled(size: 12, weight: .medium))
            .lineLimit(1)
            .frame(maxWidth: .infinity)
            .frame(height: TextScale.shared(ContextCardMetrics.segmentHeight))
            .contentShape(.rect)
        }
        .buttonStyle(SegmentButtonStyle(selected: selected))
        .help(segment.help)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
      trailing
    }
  }
}

private struct SegmentButtonStyle: ButtonStyle {
  let selected: Bool

  func makeBody(configuration: Configuration) -> some View {
    SegmentHighlight(label: configuration.label, pressed: configuration.isPressed, selected: selected).clickable()
  }
}

private struct SegmentHighlight<Label: View>: View {
  @Environment(\.theme) private var theme
  let label: Label
  let pressed: Bool
  let selected: Bool
  @State private var hovering = false

  var body: some View {
    label
      .foregroundStyle(selected || hovering ? theme.text : theme.textSecondary)
      .background {
        if selected || pressed {
          RoundedRectangle(cornerRadius: 7).fill(pressed && !selected ? theme.bgHover : theme.selection)
        } else if hovering {
          RoundedRectangle(cornerRadius: 7).fill(theme.bgHover)
        }
      }
      .onHover { hovering = $0 }
  }
}

#Preview {
  @Previewable @State var selection = "agent"
  @Previewable @State var collapsed = false
  VStack(spacing: 16) {
    ForEach([true, false], id: \.self) { chrome in
      ContextCard(chrome: chrome) {
        ContextCardSegments(
          segments: [
            ContextCardSegment(id: "agent", title: "Agent", symbol: "sparkles"),
            ContextCardSegment(id: "code", title: "Code", symbol: "chevron.left.forwardslash.chevron.right"),
            ContextCardSegment(id: "git", title: "Git", symbol: "arrow.triangle.branch"),
          ],
          selection: selection
        ) { selection = $0 } trailing: {
          Button {
            collapsed.toggle()
          } label: {
            Label("Collapse", systemImage: collapsed ? "chevron.down" : "chevron.up")
          }
          .buttonStyle(FlatIconButtonStyle(size: 22))
        }
      }
    }
  }
  .padding()
}
