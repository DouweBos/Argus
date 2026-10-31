import ArgusCore
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
  /// For system controls (`.tint`), which draw white labels and knobs on it.
  public var tint: Color
  /// A switch's on track; Muted's grey would read as off, so it borrows amber.
  public var switchTint: Color
  public var success: Color
  public var successSoft: Color
  public var warning: Color
  public var warningSoft: Color
  public var error: Color
  public var errorSoft: Color
  public var brandPurple: Color
  public var mediaBg: Color
  /// The sidebar column, a step off the canvas.
  public var sidebar: Color
  /// A floating card over the canvas (the session context card, popovers).
  public var surface: Color
  /// A selected list row: a quiet fill, not the accent.
  public var selection: Color

  public let radius: CGFloat = 12
  public let radiusSmall: CGFloat = 8
  public let space: CGFloat = 12

  /// Dims the window under a floating panel (the command palette).
  public var scrim: Color { .black.opacity(scheme == .dark ? 0.45 : 0.18) }

  /// A selected pill tab: the label colour inverted, as Grove's tab bar draws it.
  public var pillSelected: Color { scheme == .light ? Color(hex: 0x1C1C1E) : .white }
  public var pillSelectedText: Color { scheme == .light ? .white : Color(hex: 0x1C1C1E) }

  /// On iOS neutral surfaces come from the system, so `List`, `Form` and
  /// navigation look like themselves. The Mac draws its own flat chrome: one
  /// near-black (or white) canvas, hairlines instead of boxes. Peacock keeps
  /// the colours that carry meaning — the accent, and the status palette.
  private static func base(
    accent: Color, accentSoft: Color, accentBorder: Color, onAccent: Color, tint: Color? = nil, switchTint: Color? = nil,
    scheme: ColorScheme
  ) -> Theme {
    let neutrals = Neutrals.for(scheme)
    return Theme(
      scheme: scheme,
      bg: neutrals.bg,
      bgSecondary: neutrals.bgSecondary,
      bgTertiary: SystemColor.tertiaryFill,
      bgHover: SystemColor.quaternaryFill,
      border: neutrals.border,
      borderSubtle: neutrals.borderSubtle,
      borderStrong: neutrals.borderStrong,
      text: SystemColor.label,
      textSecondary: SystemColor.secondaryLabel,
      textMuted: Neutrals.mutedText,
      accent: accent,
      accentSoft: accentSoft,
      accentBorder: accentBorder,
      onAccent: onAccent,
      tint: tint ?? accent,
      switchTint: switchTint ?? accent,
      success: scheme == .light ? Color(hex: 0x00A884) : Color(hex: 0x00D4AA),
      successSoft: (scheme == .light ? Color(hex: 0x00A884) : Color(hex: 0x00D4AA)).opacity(0.16),
      warning: scheme == .light ? Color(hex: 0xD69A00) : Color(hex: 0xFFD54A),
      warningSoft: (scheme == .light ? Color(hex: 0xD69A00) : Color(hex: 0xFFD54A)).opacity(0.16),
      error: scheme == .light ? Color(hex: 0xDC2C49) : Color(hex: 0xFF4466),
      errorSoft: (scheme == .light ? Color(hex: 0xDC2C49) : Color(hex: 0xFF4466)).opacity(0.14),
      brandPurple: Color(hex: 0x7C5CFC),
      mediaBg: .black,
      sidebar: neutrals.sidebar,
      surface: neutrals.surface,
      selection: neutrals.selection
    )
  }

  /// The default colour theme's tokens, for anything not told the user's pick.
  public static let dark = resolved(for: .dark, colorTheme: .sanitize(nil))
  public static let light = resolved(for: .light, colorTheme: .sanitize(nil))

  public static func resolved(for scheme: ColorScheme) -> Theme {
    scheme == .light ? .light : .dark
  }

  /// The scheme's tokens with a colour theme's accent; surfaces stay the system's.
  public static func resolved(for scheme: ColorScheme, colorTheme: ColorTheme) -> Theme {
    let accent = colorTheme.accent(for: scheme)
    let onAccent = scheme == .light ? Color.white : colorTheme.darkOnAccent
    return base(
      accent: accent,
      accentSoft: accent.opacity(scheme == .light ? 0.14 : 0.12),
      accentBorder: accent.opacity(scheme == .light ? 0.5 : 0.4),
      onAccent: onAccent,
      // A near-white tint would hide those white labels and knobs.
      tint: colorTheme == .muted && scheme == .dark ? Color(hex: 0x6E6E7A) : accent,
      switchTint: colorTheme == .muted ? ColorTheme.amber.accent(for: scheme) : accent,
      scheme: scheme)
  }
}

/// Each preset's accent, twins of `html[data-color-theme]` in `tokens.css`.
extension ColorTheme {
  public func accent(for scheme: ColorScheme) -> Color {
    let (light, dark): (UInt32, UInt32) =
      switch self {
      case .muted: (0x18181F, 0xECECF1)
      case .amber: (0xC7861F, 0xF5A623)
      case .grove: (0x23875A, 0x5FD39A)
      case .ocean: (0x2367B8, 0x5AA9F0)
      case .ember: (0xC4501F, 0xF2784B)
      case .iris: (0x6B4FD1, 0xA78BFA)
      case .rose: (0xC23A73, 0xF27AA8)
      }
    return Color(hex: scheme == .light ? light : dark)
  }

  /// Text on a dark-scheme accent: each preset's own dark canvas.
  var darkOnAccent: Color {
    switch self {
    case .muted, .amber: Color(hex: 0x15151C)
    case .grove: Color(hex: 0x0F1512)
    case .ocean: Color(hex: 0x0F141B)
    case .ember: Color(hex: 0x1B1513)
    case .iris: Color(hex: 0x15121C)
    case .rose: Color(hex: 0x1C1418)
    }
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

/// The surfaces and hairlines a scheme draws its chrome with.
private struct Neutrals {
  var bg, bgSecondary, sidebar, surface, selection, border, borderSubtle, borderStrong: Color

  /// Captions and hints. iOS's tertiary label is too faint on its grouped
  /// backgrounds, so the phone uses the secondary one.
  static var mutedText: Color {
    #if os(macOS)
      SystemColor.tertiaryLabel
    #else
      SystemColor.secondaryLabel
    #endif
  }

  static func `for`(_ scheme: ColorScheme) -> Neutrals {
    #if os(macOS)
      let dark = scheme == .dark
      let ink: Color = dark ? .white : .black
      return Neutrals(
        bg: Color(hex: dark ? 0x0D0D0F : 0xFFFFFF),
        bgSecondary: Color(hex: dark ? 0x161618 : 0xF6F6F7),
        sidebar: Color(hex: dark ? 0x111113 : 0xF7F7F8),
        surface: Color(hex: dark ? 0x141416 : 0xFFFFFF),
        selection: ink.opacity(dark ? 0.07 : 0.055),
        border: ink.opacity(dark ? 0.09 : 0.1),
        borderSubtle: ink.opacity(0.05),
        borderStrong: ink.opacity(dark ? 0.18 : 0.2))
    #else
      return Neutrals(
        bg: SystemColor.groupedBackground,
        bgSecondary: SystemColor.secondaryGroupedBackground,
        sidebar: SystemColor.secondaryGroupedBackground,
        surface: SystemColor.secondaryGroupedBackground,
        selection: SystemColor.quaternaryFill,
        border: SystemColor.separator,
        borderSubtle: SystemColor.separator.opacity(0.5),
        borderStrong: SystemColor.opaqueSeparator)
    #endif
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
