package dev.houwert.argus.ui.mermaid

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import dev.houwert.argus.ui.theme.ArgusColors
import kotlin.math.roundToInt

/**
 * The theme's tokens as Mermaid `base` theme variables, so a diagram is drawn in the app's own
 * colours in either scheme. Opaque hex only: Mermaid derives shades and can't from a translucent colour.
 */
@Immutable
data class MermaidPalette(val variables: Map<String, String>) {
  companion object {
    fun of(theme: ArgusColors): MermaidPalette {
      val canvas = theme.bgSecondary
      fun hex(color: Color) = hex(color, canvas)
      val node = hex(theme.bgTertiary)
      val border = hex(theme.borderStrong)
      val text = hex(theme.text)
      val muted = hex(theme.textSecondary)
      val accent = hex(theme.accentSoft)
      return MermaidPalette(
        mapOf(
          "darkMode" to theme.isDark.toString(),
          "background" to hex(canvas),
          "fontSize" to "14px",
          "primaryColor" to node,
          "primaryBorderColor" to border,
          "primaryTextColor" to text,
          "secondaryColor" to accent,
          "secondaryBorderColor" to hex(theme.accentBorder),
          "secondaryTextColor" to text,
          "tertiaryColor" to hex(theme.bg),
          "tertiaryBorderColor" to hex(theme.border),
          "tertiaryTextColor" to text,
          "lineColor" to muted,
          "textColor" to text,
          "mainBkg" to node,
          "nodeBorder" to border,
          "clusterBkg" to hex(theme.bg),
          "clusterBorder" to hex(theme.border),
          "titleColor" to text,
          "edgeLabelBackground" to hex(canvas),
          "noteBkgColor" to hex(theme.warningSoft),
          "noteBorderColor" to hex(theme.warning),
          "noteTextColor" to text,
          "actorBkg" to node,
          "actorBorder" to border,
          "actorTextColor" to text,
          "actorLineColor" to muted,
          "signalColor" to muted,
          "signalTextColor" to text,
          "labelBoxBkgColor" to node,
          "labelBoxBorderColor" to border,
          "labelTextColor" to text,
          "loopTextColor" to text,
          "activationBkgColor" to accent,
          "activationBorderColor" to border,
          "sequenceNumberColor" to hex(theme.onAccent),
          "errorBkgColor" to hex(theme.errorSoft),
          "errorTextColor" to hex(theme.error),
        ),
      )
    }

    /** `#rrggbb`, a translucent colour composited over [background] first. */
    fun hex(color: Color, background: Color): String {
      val alpha = color.alpha
      fun channel(top: Float, bottom: Float) = ((top * alpha + bottom * (1 - alpha)) * 255).roundToInt().coerceIn(0, 255)
      val r = channel(color.red, background.red)
      val g = channel(color.green, background.green)
      val b = channel(color.blue, background.blue)
      return "#%02x%02x%02x".format(r, g, b)
    }
  }
}
