package dev.houwert.argus.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.unit.dp

val LocalArgusColors = staticCompositionLocalOf { ArgusColors.Dark }
val LocalArgusTypography = staticCompositionLocalOf { ArgusTypography() }

/**
 * The root of every Argus screen: Material 3 underneath with Argus tokens mapped onto it, and
 * the tokens themselves on [ArgusTheme.colors]. Components read the tokens, never raw colours.
 */
@Composable
fun ArgusTheme(
  preference: ThemePreference = ThemePreference.System,
  colorTheme: ColorTheme = ColorTheme.Default,
  content: @Composable () -> Unit,
) {
  val dark =
    when (preference) {
      ThemePreference.System -> isSystemInDarkTheme()
      ThemePreference.Light -> false
      ThemePreference.Dark -> true
    }
  ArgusTheme(dark = dark, colorTheme = colorTheme, content = content)
}

@Composable
fun ArgusTheme(dark: Boolean, colorTheme: ColorTheme = ColorTheme.Default, content: @Composable () -> Unit) {
  val colors = remember(dark, colorTheme) { ArgusColors.resolve(dark, colorTheme) }
  val typography = remember { ArgusTypography() }
  CompositionLocalProvider(LocalArgusColors provides colors, LocalArgusTypography provides typography) {
    MaterialTheme(
      colorScheme = remember(colors) { colors.materialScheme() },
      typography = remember(typography) { typography.material() },
      shapes = ArgusShapes,
    ) {
      CompositionLocalProvider(LocalContentColor provides colors.text, content = content)
    }
  }
}

/** Token access for components and screens: `ArgusTheme.colors.accent`. */
object ArgusTheme {
  val colors: ArgusColors
    @Composable @ReadOnlyComposable get() = LocalArgusColors.current

  val typography: ArgusTypography
    @Composable @ReadOnlyComposable get() = LocalArgusTypography.current

  val syntax: SyntaxPalette
    @Composable @ReadOnlyComposable get() = LocalArgusColors.current.syntax

  val metrics: ArgusMetrics get() = ArgusMetrics
}

private val ArgusShapes =
  Shapes(
    extraSmall = RoundedCornerShape(6.dp),
    small = RoundedCornerShape(ArgusMetrics.radiusSmall),
    medium = RoundedCornerShape(ArgusMetrics.radius),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp),
  )

/** Material's roles filled from Argus tokens, so stock M3 widgets sit beside ours without clashing. */
private fun ArgusColors.materialScheme(): ColorScheme {
  // M3 surfaces must be opaque; translucent fills are flattened over the canvas.
  fun Color.flat(over: Color = bg) = compositeOver(over)
  val base = if (isDark) darkColorScheme() else lightColorScheme()
  return base.copy(
    primary = accent,
    onPrimary = onAccent,
    primaryContainer = accentSoft.flat(bgSecondary),
    onPrimaryContainer = text,
    inversePrimary = accent,
    secondary = textSecondary.flat(),
    onSecondary = bg,
    secondaryContainer = bgTertiary.flat(bgSecondary),
    onSecondaryContainer = text,
    tertiary = brandPurple,
    onTertiary = Color.White,
    background = bg,
    onBackground = text,
    surface = bgSecondary,
    onSurface = text,
    surfaceVariant = bgTertiary.flat(bgSecondary),
    onSurfaceVariant = textSecondary.flat(bgSecondary),
    surfaceTint = Color.Transparent,
    surfaceBright = bgSecondary,
    surfaceDim = bg,
    surfaceContainerLowest = bg,
    surfaceContainerLow = bgSecondary,
    surfaceContainer = bgSecondary,
    surfaceContainerHigh = bgSecondary,
    surfaceContainerHighest = bgTertiary.flat(bgSecondary),
    inverseSurface = text,
    inverseOnSurface = bg,
    error = error,
    onError = Color.White,
    errorContainer = errorSoft.flat(bgSecondary),
    onErrorContainer = error,
    outline = borderStrong,
    outlineVariant = border.flat(bgSecondary),
    scrim = Color.Black,
  )
}

private fun ArgusTypography.material(): Typography =
  Typography(
    displayLarge = largeTitle,
    displayMedium = largeTitle,
    displaySmall = title,
    headlineLarge = title,
    headlineMedium = title2,
    headlineSmall = title3,
    titleLarge = title3,
    titleMedium = headline,
    titleSmall = subheadline.copy(fontWeight = headline.fontWeight),
    bodyLarge = body,
    bodyMedium = subheadline,
    bodySmall = footnote,
    labelLarge = subheadline.copy(fontWeight = headline.fontWeight),
    labelMedium = caption.copy(fontWeight = headline.fontWeight),
    labelSmall = caption2,
  )
