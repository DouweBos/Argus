package dev.houwert.argus.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Peacock's tokens for Compose, twins of `Theme.swift` (and so of `tokens.css`).
 * Both schemes are spelled out because a hardcoded colour silently breaks the other one.
 */
@Immutable
data class ArgusColors(
  val isDark: Boolean,
  val bg: Color,
  val bgSecondary: Color,
  val bgTertiary: Color,
  val bgHover: Color,
  val border: Color,
  val borderSubtle: Color,
  val borderStrong: Color,
  val text: Color,
  val textSecondary: Color,
  val textMuted: Color,
  val accent: Color,
  val accentSoft: Color,
  val accentBorder: Color,
  val onAccent: Color,
  /** For system controls that draw white labels and knobs on it. */
  val tint: Color,
  /** A switch's on track; Muted's grey would read as off, so it borrows amber. */
  val switchTint: Color,
  val success: Color,
  val successSoft: Color,
  val warning: Color,
  val warningSoft: Color,
  val error: Color,
  val errorSoft: Color,
  val brandPurple: Color,
  val mediaBg: Color,
  /** The sidebar column, a step off the canvas. */
  val sidebar: Color,
  /** A floating card over the canvas (context card, popovers). */
  val surface: Color,
  /** A selected list row: a quiet fill, not the accent. */
  val selection: Color,
) {
  /** Dims the window under a floating panel. */
  val scrim: Color get() = Color.Black.copy(alpha = if (isDark) 0.45f else 0.18f)

  /** Pull request states in GitHub's own hues, twins of `--pr-*`. */
  val prOpen: Color get() = hex(if (isDark) 0x3FB950 else 0x1A7F37)
  val prDraft: Color get() = hex(if (isDark) 0x9198A1 else 0x59636E)
  val prMerged: Color get() = hex(if (isDark) 0xAB7DF8 else 0x8250DF)
  val prClosed: Color get() = hex(if (isDark) 0xF85149 else 0xD1242F)

  /** Categorical chart series in fixed order, twins of `--chart-series-*`; always with a legend. */
  val chartSeries: List<Color>
    get() =
      (if (isDark) listOf(0x3987E5, 0xD95926, 0x199E70, 0xC98500) else listOf(0x2A78D6, 0xEB6834, 0x1BAF7A, 0xEDA100))
        .map(::hex)

  /** A selected pill tab: the label colour inverted. */
  val pillSelected: Color get() = if (isDark) Color.White else hex(0x1C1C1E)
  val pillSelectedText: Color get() = if (isDark) hex(0x1C1C1E) else Color.White

  /** A segmented control's raised thumb, as iOS draws it. */
  val segmentSelected: Color get() = if (isDark) hex(0x636366) else hex(0xFFFFFF)

  val syntax: SyntaxPalette get() =if (isDark) SyntaxPalette.Dark else SyntaxPalette.Light

  companion object {
    val Light = resolve(dark = false, colorTheme = ColorTheme.Default)
    val Dark = resolve(dark = true, colorTheme = ColorTheme.Default)

    /** The scheme's tokens with a colour theme's accent; neutrals stay iOS's grouped palette. */
    fun resolve(dark: Boolean, colorTheme: ColorTheme): ArgusColors {
      val n = if (dark) Neutrals.Dark else Neutrals.Light
      val accent = colorTheme.accent(dark)
      val success = hex(if (dark) 0x00D4AA else 0x00A884)
      val warning = hex(if (dark) 0xFFD54A else 0xD69A00)
      val error = hex(if (dark) 0xFF4466 else 0xDC2C49)
      return ArgusColors(
        isDark = dark,
        bg = n.bg,
        bgSecondary = n.bgSecondary,
        bgTertiary = n.tertiaryFill,
        bgHover = n.quaternaryFill,
        border = n.separator,
        borderSubtle = n.separator.copy(alpha = n.separator.alpha * 0.5f),
        borderStrong = n.opaqueSeparator,
        text = n.label,
        textSecondary = n.secondaryLabel,
        // iOS's tertiary label is too faint on grouped backgrounds, so muted uses the secondary one.
        textMuted = n.secondaryLabel,
        accent = accent,
        accentSoft = accent.copy(alpha = if (dark) 0.12f else 0.14f),
        accentBorder = accent.copy(alpha = if (dark) 0.4f else 0.5f),
        onAccent = if (dark) colorTheme.darkOnAccent else Color.White,
        // A near-white tint would hide white labels and knobs.
        tint = if (colorTheme == ColorTheme.Muted && dark) hex(0x6E6E7A) else accent,
        switchTint = if (colorTheme == ColorTheme.Muted) ColorTheme.Amber.accent(dark) else accent,
        success = success,
        successSoft = success.copy(alpha = 0.16f),
        warning = warning,
        warningSoft = warning.copy(alpha = 0.16f),
        error = error,
        errorSoft = error.copy(alpha = 0.14f),
        brandPurple = hex(0x7C5CFC),
        mediaBg = Color.Black,
        sidebar = n.bgSecondary,
        surface = n.bgSecondary,
        selection = n.quaternaryFill,
      )
    }
  }
}

/** iOS's system neutrals by role (UIKit's grouped palette), which the phone's chrome is drawn in. */
private class Neutrals(
  val bg: Color,
  val bgSecondary: Color,
  val tertiaryFill: Color,
  val quaternaryFill: Color,
  val separator: Color,
  val opaqueSeparator: Color,
  val label: Color,
  val secondaryLabel: Color,
) {
  companion object {
    val Light =
      Neutrals(
        bg = hex(0xF2F2F7),
        bgSecondary = hex(0xFFFFFF),
        tertiaryFill = hex(0x767680, 0.12f),
        quaternaryFill = hex(0x747480, 0.08f),
        separator = hex(0x3C3C43, 0.29f),
        opaqueSeparator = hex(0xC6C6C8),
        label = hex(0x000000),
        secondaryLabel = hex(0x3C3C43, 0.6f),
      )
    val Dark =
      Neutrals(
        bg = hex(0x000000),
        bgSecondary = hex(0x1C1C1E),
        tertiaryFill = hex(0x767680, 0.24f),
        quaternaryFill = hex(0x767680, 0.18f),
        separator = hex(0x545458, 0.6f),
        opaqueSeparator = hex(0x38383A),
        label = hex(0xFFFFFF),
        secondaryLabel = hex(0xEBEBF5, 0.6f),
      )
  }
}

/** The user's accent preset, twins of `html[data-color-theme]` in `tokens.css`. */
enum class ColorTheme(val raw: String) {
  Muted("muted"),
  Amber("amber"),
  Grove("grove"),
  Ocean("ocean"),
  Ember("ember"),
  Iris("iris"),
  Rose("rose");

  val label: String get() = raw.replaceFirstChar { it.uppercase() }

  fun accent(dark: Boolean): Color {
    val (light, darkHex) =
      when (this) {
        Muted -> 0x18181F to 0xECECF1
        Amber -> 0xC7861F to 0xF5A623
        Grove -> 0x23875A to 0x5FD39A
        Ocean -> 0x2367B8 to 0x5AA9F0
        Ember -> 0xC4501F to 0xF2784B
        Iris -> 0x6B4FD1 to 0xA78BFA
        Rose -> 0xC23A73 to 0xF27AA8
      }
    return hex(if (dark) darkHex else light)
  }

  /** Text on a dark-scheme accent: each preset's own dark canvas. */
  val darkOnAccent: Color
    get() =
      hex(
        when (this) {
          Muted, Amber -> 0x15151C
          Grove -> 0x0F1512
          Ocean -> 0x0F141B
          Ember -> 0x1B1513
          Iris -> 0x15121C
          Rose -> 0x1C1418
        }
      )

  companion object {
    val Default = Muted

    fun sanitize(raw: String?): ColorTheme = entries.firstOrNull { it.raw == raw } ?: Default
  }
}

/** The user's light/dark choice, independent of what the system is doing. */
enum class ThemePreference(val raw: String, val label: String) {
  System("system", "System"),
  Light("light", "Light"),
  Dark("dark", "Dark");

  companion object {
    fun sanitize(raw: String?): ThemePreference = entries.firstOrNull { it.raw == raw } ?: System
  }
}

/** Semantic tones, shared by badges, banners, status dots and report blocks. */
enum class Tone {
  Accent,
  Danger,
  Muted,
  Success,
  Warning;

  fun color(theme: ArgusColors): Color =
    when (this) {
      Accent -> theme.accent
      Danger -> theme.error
      Muted -> theme.textMuted
      Success -> theme.success
      Warning -> theme.warning
    }

  fun soft(theme: ArgusColors): Color =
    when (this) {
      Accent -> theme.accentSoft
      Danger -> theme.errorSoft
      Muted -> theme.bgTertiary
      Success -> theme.successSoft
      Warning -> theme.warningSoft
    }
}

/** `0xRRGGBB` as an opaque (or `alpha`) sRGB colour. */
fun hex(rgb: Int, alpha: Float = 1f): Color = Color(0xFF000000.toInt() or rgb).copy(alpha = alpha)
