import ArgusCore
import SwiftUI

/// System, Light and Dark as small window previews, the picked one outlined.
/// Generic so either module's `system`/`light`/`dark` preference can drive it.
public struct ColorSchemeCards<Preference>: View
where Preference: CaseIterable & Hashable & RawRepresentable, Preference.RawValue == String,
  Preference.AllCases: RandomAccessCollection
{
  @Environment(\.theme) private var theme
  @Binding private var selection: Preference
  private let colorTheme: ColorTheme

  public init(selection: Binding<Preference>, colorTheme: ColorTheme) {
    _selection = selection
    self.colorTheme = colorTheme
  }

  public var body: some View {
    HStack(spacing: 10) {
      ForEach(Preference.allCases, id: \.self) { preference in
        AppearanceCard(selected: selection == preference) {
          selection = preference
        } content: {
          VStack(spacing: 8) {
            preview(preference)
              .frame(height: 84)
              .clipShape(.rect(cornerRadius: 6))
            Text(Self.title(preference))
              .font(.scaled(size: 12))
              .foregroundStyle(selection == preference ? theme.text : theme.textSecondary)
          }
        }
        .accessibilityLabel(Self.title(preference))
      }
    }
  }

  private static func title(_ preference: Preference) -> String {
    preference.rawValue.capitalized
  }

  @ViewBuilder private func preview(_ preference: Preference) -> some View {
    switch preference.rawValue {
    case "light": WindowPreview(colorTheme: colorTheme).environment(\.colorScheme, .light)
    case "dark": WindowPreview(colorTheme: colorTheme).environment(\.colorScheme, .dark)
    default:
      // Half and half: the left in light, the right in dark.
      ZStack {
        WindowPreview(colorTheme: colorTheme).environment(\.colorScheme, .dark)
        WindowPreview(colorTheme: colorTheme).environment(\.colorScheme, .light)
          .mask(alignment: .leading) {
            GeometryReader { proxy in Rectangle().frame(width: proxy.size.width / 2) }
          }
      }
    }
  }
}

/// A sketch of the app window in one scheme: sidebar, a few lines, a composer.
private struct WindowPreview: View {
  @Environment(\.colorScheme) private var scheme
  let colorTheme: ColorTheme

  var body: some View {
    let theme = Theme.resolved(for: scheme, colorTheme: colorTheme)
    HStack(spacing: 0) {
      VStack(alignment: .leading, spacing: 5) {
        ForEach(0..<4, id: \.self) { index in
          Capsule().fill(index == 1 ? theme.borderStrong : theme.border).frame(width: index == 1 ? 26 : 20, height: 4)
        }
        Spacer(minLength: 0)
      }
      .padding(8)
      .frame(width: 44, alignment: .leading)
      .frame(maxHeight: .infinity)
      .background(theme.sidebar)
      Rectangle().fill(theme.border).frame(width: 1)
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          Spacer()
          Capsule().fill(theme.border).frame(width: 34, height: 7)
        }
        Capsule().fill(theme.borderStrong).frame(width: 52, height: 4)
        Capsule().fill(theme.border).frame(width: 40, height: 4)
        Spacer(minLength: 0)
        HStack {
          Capsule().fill(theme.border).frame(width: 36, height: 4)
          Spacer()
          Circle().fill(theme.accent).frame(width: 8, height: 8)
        }
        .padding(.horizontal, 6)
        .frame(height: 16)
        .background(theme.surface, in: .rect(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).strokeBorder(theme.borderStrong))
      }
      .padding(8)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .background(theme.bg)
  }
}

/// Each colour theme as a card: its light and dark accents side by side.
public struct ColorThemeCards: View {
  @Environment(\.theme) private var theme
  @Binding private var selection: ColorTheme
  private let columns: Int

  public init(selection: Binding<ColorTheme>, columns: Int = 3) {
    _selection = selection
    self.columns = columns
  }

  public var body: some View {
    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: columns), spacing: 10) {
      ForEach(ColorTheme.allCases, id: \.self) { preset in
        let picked = selection == preset
        AppearanceCard(selected: picked) {
          selection = preset
        } content: {
          VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
              Swatch(color: preset.accent(for: .light), picked: picked)
              Swatch(color: preset.accent(for: .dark), picked: picked)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            Text(preset.label)
              .font(.scaled(size: 12, weight: .medium))
              .foregroundStyle(picked ? theme.text : theme.textSecondary)
              .padding(.horizontal, 4)
          }
        }
        .accessibilityLabel(preset.label)
      }
    }
  }
}

private struct Swatch: View {
  @Environment(\.theme) private var theme
  let color: Color
  let picked: Bool

  var body: some View {
    Circle()
      .fill(color.gradient)
      .frame(width: 30, height: 30)
      .overlay {
        Circle().strokeBorder(theme.text.opacity(0.85), lineWidth: 1.5).padding(-4).opacity(picked ? 1 : 0)
      }
      .padding(4)
  }
}

/// A selectable card: the surface with a hairline, the accent outline when picked.
private struct AppearanceCard<Content: View>: View {
  @Environment(\.theme) private var theme
  let selected: Bool
  let action: () -> Void
  @ViewBuilder let content: Content
  @State private var hovering = false

  var body: some View {
    Button(action: action) {
      content
        .padding(6)
        .frame(maxWidth: .infinity)
        .background(theme.surface, in: .rect(cornerRadius: theme.radiusSmall + 2))
        .overlay(
          RoundedRectangle(cornerRadius: theme.radiusSmall + 2)
            .strokeBorder(
              selected ? theme.accent : (hovering ? theme.borderStrong : theme.border),
              lineWidth: selected ? 1.5 : 1)
        )
        .contentShape(.rect(cornerRadius: theme.radiusSmall + 2))
    }
    .buttonStyle(.plain)
    .onHover { hovering = $0 }
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}

#Preview {
  VStack(alignment: .leading, spacing: 16) {
    ColorSchemeCards(selection: .constant(ThemePreference.system), colorTheme: .amber)
    ColorThemeCards(selection: .constant(.grove))
  }
  .padding()
  .frame(width: 720)
}
