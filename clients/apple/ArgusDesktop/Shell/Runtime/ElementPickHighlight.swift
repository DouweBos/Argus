import ArgusUI
import SwiftUI

/// The hovered element's outline and name while selecting, over the browser's
/// screencast or a device's picture. `rect` and `bounds` are in the stage.
struct ElementPickHighlight: View {
  @Environment(\.theme) private var theme
  let rect: CGRect
  let label: String
  /// The picture; the outline is clipped to it and the label stays inside.
  let bounds: CGRect

  var body: some View {
    let rect = rect.intersection(bounds)
    if !rect.isNull {
      ZStack(alignment: .topLeading) {
        Rectangle()
          .fill(theme.accent.opacity(0.15))
          .overlay(Rectangle().strokeBorder(theme.accent, lineWidth: 1.5))
          .frame(width: rect.width, height: rect.height)
          .offset(x: rect.minX, y: rect.minY)
        Text(label)
          .font(.scaled(size: 11, design: .monospaced))
          .foregroundStyle(theme.onAccent)
          .lineLimit(1)
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(theme.accent, in: .rect(cornerRadius: 4))
          .fixedSize()
          .offset(x: rect.minX, y: rect.minY >= bounds.minY + 20 ? rect.minY - 20 : rect.maxY + 2)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      .allowsHitTesting(false)
    }
  }
}

/// The toolbar's Select Element toggle, the same in the Browser tab and over a device.
struct ElementPickButton: View {
  @Environment(\.theme) private var theme
  let active: Bool
  var loading = false
  var size: CGFloat = 20
  let toggle: () -> Void

  var body: some View {
    Button(action: toggle) {
      Group {
        if loading {
          ProgressView().controlSize(.mini)
        } else {
          Image(systemName: Icon.elementPick)
            .foregroundStyle(active ? theme.accent : theme.textSecondary)
        }
      }
      .frame(width: size, height: size)
    }
    .buttonStyle(.argusBorderless)
    .help(active ? "Cancel selecting (Esc)" : "Select an element to attach to the chat")
    .accessibilityLabel("Select element")
    .accessibilityAddTraits(active ? .isSelected : [])
  }
}
