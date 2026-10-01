import SwiftUI

/// Peacock's tokens, resolved for SwiftUI.
///
/// Peacock is DOM-only, so these are hand-kept twins of `tokens.css`. Both
/// schemes are spelled out because a hardcoded colour silently breaks the
/// other one — the same rule the web and RN clients follow.
public struct Theme: Sendable, Equatable {
  public var scheme: ColorScheme

  public var bg: Color
  public var bgSecondary: Color
  public var bgTertiary: Color
  public var bgHover: Color
  public var border: Color
  public var borderSubtle: Color
  public var borderStrong: Color
  public var text: Color
  public var textSecondary: Color
  public var textMuted: Color
  public var accent: Color
  public var accentSoft: Color
  public var accentBorder: Color
  public var onAccent: Color
  public var success: Color
  public var successSoft: Color
  public var warning: Color
  public var warningSoft: Color
  public var error: Color
  public var errorSoft: Color
  public var brandPurple: Color
  public var mediaBg: Color

  public let radius: CGFloat = 12
  public let radiusSmall: CGFloat = 8
  public let space: CGFloat = 12

  /// Neutral surfaces and text come from the system, so `List`, `Form` and
  /// the sidebar look like themselves and adapt to light, dark, increased
  /// contrast and Liquid Glass without being fought. Peacock keeps the colours
  /// that carry meaning — the accent, and the status palette.
  private static func base(accent: Color, accentSoft: Color, accentBorder: Color, onAccent: Color, scheme: ColorScheme) -> Theme {
    Theme(
      scheme: scheme,
      bg: SystemColor.groupedBackground,
      bgSecondary: SystemColor.secondaryGroupedBackground,
      bgTertiary: SystemColor.tertiaryFill,
      bgHover: SystemColor.quaternaryFill,
      border: SystemColor.separator,
      borderSubtle: SystemColor.separator.opacity(0.5),
      borderStrong: SystemColor.opaqueSeparator,
      text: SystemColor.label,
      textSecondary: SystemColor.secondaryLabel,
      textMuted: SystemColor.tertiaryLabel,
      accent: accent,
      accentSoft: accentSoft,
      accentBorder: accentBorder,
      onAccent: onAccent,
      success: scheme == .light ? Color(hex: 0x00A884) : Color(hex: 0x00D4AA),
      successSoft: (scheme == .light ? Color(hex: 0x00A884) : Color(hex: 0x00D4AA)).opacity(0.16),
      warning: scheme == .light ? Color(hex: 0xD69A00) : Color(hex: 0xFFD54A),
      warningSoft: (scheme == .light ? Color(hex: 0xD69A00) : Color(hex: 0xFFD54A)).opacity(0.16),
      error: scheme == .light ? Color(hex: 0xDC2C49) : Color(hex: 0xFF4466),
      errorSoft: (scheme == .light ? Color(hex: 0xDC2C49) : Color(hex: 0xFF4466)).opacity(0.14),
      brandPurple: Color(hex: 0x7C5CFC),
      mediaBg: .black
    )
  }

  public static let dark = base(
    accent: Color(hex: 0xF5A623),
    accentSoft: Color(hex: 0xF5A623).opacity(0.12),
    accentBorder: Color(hex: 0xF5A623).opacity(0.4),
    onAccent: Color(hex: 0x15151C),
    scheme: .dark)

  public static let light = base(
    accent: Color(hex: 0xC7861F),
    accentSoft: Color(hex: 0xC7861F).opacity(0.14),
    accentBorder: Color(hex: 0xC7861F).opacity(0.5),
    onAccent: .white,
    scheme: .light)

  public static func resolved(for scheme: ColorScheme) -> Theme {
    scheme == .light ? .light : .dark
  }
}

/// Semantic tones, shared by badges, banners, status dots and report blocks.
public enum Tone: Sendable {
  case accent, danger, muted, success, warning

  public func color(_ theme: Theme) -> Color {
    switch self {
    case .accent: theme.accent
    case .danger: theme.error
    case .muted: theme.textMuted
    case .success: theme.success
    case .warning: theme.warning
    }
  }

  public func soft(_ theme: Theme) -> Color {
    switch self {
    case .accent: theme.accentSoft
    case .danger: theme.errorSoft
    case .muted: theme.bgTertiary
    case .success: theme.successSoft
    case .warning: theme.warningSoft
    }
  }
}

extension Color {
  public init(hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      opacity: 1
    )
  }
}

private struct ThemeKey: EnvironmentKey {
  static let defaultValue = Theme.dark
}

extension EnvironmentValues {
  public var theme: Theme {
    get { self[ThemeKey.self] }
    set { self[ThemeKey.self] = newValue }
  }
}

/// The user's choice, independent of what the system is doing.
public enum ThemePreference: String, CaseIterable, Sendable {
  case system, light, dark

  public var label: String {
    switch self {
    case .system: "System"
    case .light: "Light"
    case .dark: "Dark"
    }
  }

  public var colorScheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }
}

/// The system's neutral palette, by role, on whichever platform this runs.
private enum SystemColor {
  #if canImport(UIKit)
    static let groupedBackground = Color(uiColor: .systemGroupedBackground)
    static let secondaryGroupedBackground = Color(uiColor: .secondarySystemGroupedBackground)
    static let tertiaryFill = Color(uiColor: .tertiarySystemFill)
    static let quaternaryFill = Color(uiColor: .quaternarySystemFill)
    static let separator = Color(uiColor: .separator)
    static let opaqueSeparator = Color(uiColor: .opaqueSeparator)
    static let label = Color(uiColor: .label)
    static let secondaryLabel = Color(uiColor: .secondaryLabel)
    static let tertiaryLabel = Color(uiColor: .tertiaryLabel)
  #else
    static let groupedBackground = Color(nsColor: .windowBackgroundColor)
    static let secondaryGroupedBackground = Color(nsColor: .controlBackgroundColor)
    static let tertiaryFill = Color(nsColor: .tertiarySystemFill)
    static let quaternaryFill = Color(nsColor: .quaternarySystemFill)
    static let separator = Color(nsColor: .separatorColor)
    static let opaqueSeparator = Color(nsColor: .gridColor)
    static let label = Color(nsColor: .labelColor)
    static let secondaryLabel = Color(nsColor: .secondaryLabelColor)
    static let tertiaryLabel = Color(nsColor: .tertiaryLabelColor)
  #endif
}
