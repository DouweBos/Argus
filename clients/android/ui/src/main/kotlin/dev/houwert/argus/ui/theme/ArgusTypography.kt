package dev.houwert.argus.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * iOS's text styles at their default (Large) sizes. `sp` follows the user's font size the
 * way `Font.scaled` follows Dynamic Type, so components size text with these or [argusFont].
 */
@Immutable
data class ArgusTypography(
  val largeTitle: TextStyle = style(34, FontWeight.Bold),
  val title: TextStyle = style(28, FontWeight.Bold),
  val title2: TextStyle = style(22, FontWeight.Bold),
  val title3: TextStyle = style(20, FontWeight.SemiBold),
  val headline: TextStyle = style(17, FontWeight.SemiBold),
  val body: TextStyle = style(17),
  val callout: TextStyle = style(16),
  val subheadline: TextStyle = style(15),
  val footnote: TextStyle = style(13),
  val caption: TextStyle = style(12),
  val caption2: TextStyle = style(11),
)

private fun style(size: Int, weight: FontWeight = FontWeight.Normal) =
  TextStyle(fontSize = size.sp, fontWeight = weight, lineHeight = 1.25.em)

/** `Font.scaled(size:weight:design:)`: a fixed point size that still follows the user's font size. */
fun argusFont(size: Float, weight: FontWeight = FontWeight.Normal, mono: Boolean = false): TextStyle =
  TextStyle(
    fontSize = size.sp,
    fontWeight = weight,
    fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
    lineHeight = 1.25.em,
  )

fun argusFont(size: Int, weight: FontWeight = FontWeight.Normal, mono: Boolean = false): TextStyle =
  argusFont(size.toFloat(), weight, mono)

/** Radii and spacing, twins of `Theme`'s constants and `Layout`. */
object ArgusMetrics {
  val radius = 12.dp
  val radiusSmall = 8.dp
  val space = 12.dp
  /** Where a full-width control stops growing; past this a button is a long strip of colour. */
  val maxControlWidth = 420.dp
  /** Where a screen's column stops growing on a tablet. */
  val maxReadingWidth = 820.dp
  /** A finger needs 44pt; Material asks for 48dp. */
  val minTouchTarget = 44.dp
}

