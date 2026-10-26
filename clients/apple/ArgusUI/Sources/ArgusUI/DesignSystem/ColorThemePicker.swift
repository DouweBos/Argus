import ArgusCore
import SwiftUI

/// A row of colour theme swatches, each drawn in the current scheme.
public struct ColorThemePicker: View {
  @Binding private var selection: ColorTheme
  @Environment(\.colorScheme) private var scheme
  @Environment(\.theme) private var theme

  public init(selection: Binding<ColorTheme>) {
    _selection = selection
  }

  public var body: some View {
    HStack(spacing: 14) {
      ForEach(ColorTheme.allCases, id: \.self) { preset in
        Button {
          selection = preset
        } label: {
          VStack(spacing: 6) {
            Circle()
              .fill(preset.accent(for: scheme))
              .frame(width: 26, height: 26)
              .overlay {
                Circle()
                  .strokeBorder(theme.text, lineWidth: 2)
                  .padding(-4)
                  .opacity(selection == preset ? 1 : 0)
              }
            Text(preset.label)
              .font(.caption)
              .foregroundStyle(selection == preset ? theme.text : theme.textSecondary)
          }
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(preset.label)
        .accessibilityAddTraits(selection == preset ? .isSelected : [])
      }
    }
    .padding(.vertical, 4)
  }
}
