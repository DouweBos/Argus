package dev.houwert.argus.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.houwert.argus.ui.icons.SfSymbol
import dev.houwert.argus.ui.images.RemoteImage
import dev.houwert.argus.ui.theme.ArgusColors
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.ColorTheme
import dev.houwert.argus.ui.theme.ThemePreference
import dev.houwert.argus.ui.theme.argusFont

/**
 * A person's picture, or their initials on a tinted circle; a person glyph while signed out or the
 * name isn't known yet. The initials show until [imageUrl] loads, and stay when it can't.
 */
@Composable
fun AccountAvatar(initials: String?, modifier: Modifier = Modifier, imageUrl: String? = null, image: Painter? = null, size: Dp = 44.dp) {
  val theme = ArgusTheme.colors
  Box(modifier.size(size).clip(CircleShape).background(theme.accentSoft).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
    when {
      image != null -> Image(image, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
      !initials.isNullOrEmpty() ->
        Text(initials, color = theme.accent, style = argusFont(size.value * 0.4f, FontWeight.SemiBold).copy(lineHeight = (size.value * 0.4f).sp))
      else -> Icon(SfSymbol["person.fill"], null, Modifier.size(size * 0.55f), tint = theme.accent)
    }
    if (image == null) RemoteImage(imageUrl, Modifier.fillMaxSize())
  }
}

/** A selectable card: the surface with a hairline, the accent outline when picked. */
@Composable
private fun AppearanceCard(selected: Boolean, label: String, modifier: Modifier, onClick: () -> Unit, content: @Composable () -> Unit) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radiusSmall + 2.dp)
  val interaction = rememberInteraction()
  Box(
    modifier
      .argusClickable(interaction, shape = shape, role = Role.RadioButton, label = label, onClick = onClick)
      .semantics { this.selected = selected }
      .background(theme.surface, shape)
      .border(
        if (selected) 1.5.dp else 1.dp,
        if (selected) theme.accent else if (interaction.hovered) theme.borderStrong else theme.border,
        shape,
      )
      .padding(6.dp)
  ) {
    content()
  }
}

/** System, Light and Dark as small window previews, the picked one outlined. */
@Composable
fun ColorSchemeCards(
  selection: ThemePreference,
  colorTheme: ColorTheme,
  onSelect: (ThemePreference) -> Unit,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    for (preference in ThemePreference.entries) {
      AppearanceCard(selection == preference, preference.label, Modifier.weight(1f), { onSelect(preference) }) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Box(Modifier.fillMaxWidth().height(84.dp).clip(RoundedCornerShape(6.dp))) {
            when (preference) {
              ThemePreference.Light -> WindowPreview(ArgusColors.resolve(false, colorTheme))
              ThemePreference.Dark -> WindowPreview(ArgusColors.resolve(true, colorTheme))
              ThemePreference.System -> {
                // Half and half: the left in light, the right in dark.
                WindowPreview(ArgusColors.resolve(true, colorTheme))
                Box(Modifier.fillMaxSize().halfClip()) { WindowPreview(ArgusColors.resolve(false, colorTheme)) }
              }
            }
          }
          Text(
            preference.label, color = if (selection == preference) theme.text else theme.textSecondary, style = argusFont(12),
          )
        }
      }
    }
  }
}

private fun Modifier.halfClip() = drawWithContent { clipRect(right = size.width / 2) { this@drawWithContent.drawContent() } }

/** A sketch of the app in one scheme: sidebar, a few lines, a composer. */
@Composable
private fun WindowPreview(t: ArgusColors) {
  Row(Modifier.fillMaxSize().background(t.bg)) {
    Column(
      Modifier.width(30.dp).fillMaxHeight().background(t.sidebar).padding(8.dp),
      verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
      repeat(4) { i -> Box(Modifier.widthIn(max = if (i == 1) 26.dp else 20.dp).fillMaxWidth().height(4.dp).background(if (i == 1) t.borderStrong else t.border, CircleShape)) }
    }
    Box(Modifier.width(1.dp).fillMaxHeight().background(t.border))
    Column(Modifier.weight(1f).fillMaxHeight().padding(8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
      Row { Spacer(Modifier.weight(1f)); Box(Modifier.size(34.dp, 7.dp).background(t.border, CircleShape)) }
      Box(Modifier.widthIn(max = 52.dp).fillMaxWidth().height(4.dp).background(t.borderStrong, CircleShape))
      Box(Modifier.widthIn(max = 40.dp).fillMaxWidth().height(4.dp).background(t.border, CircleShape))
      Spacer(Modifier.weight(1f))
      Row(
        Modifier.fillMaxWidth().height(16.dp).background(t.surface, RoundedCornerShape(5.dp)).border(1.dp, t.borderStrong, RoundedCornerShape(5.dp)).padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Box(Modifier.widthIn(max = 36.dp).weight(1f).height(4.dp).background(t.border, CircleShape))
        Spacer(Modifier.weight(0.3f))
        Box(Modifier.size(8.dp).background(t.accent, CircleShape))
      }
    }
  }
}

/** Each colour theme as a card: its light and dark accents side by side. */
@Composable
fun ColorThemeCards(selection: ColorTheme, onSelect: (ColorTheme) -> Unit, modifier: Modifier = Modifier, columns: Int = 3) {
  val theme = ArgusTheme.colors
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    for (row in ColorTheme.entries.chunked(columns)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for (preset in row) {
          val picked = selection == preset
          AppearanceCard(picked, preset.label, Modifier.weight(1f), { onSelect(preset) }) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
              Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)) {
                Swatch(preset.accent(false), picked)
                Swatch(preset.accent(true), picked)
              }
              Text(
                preset.label, Modifier.padding(horizontal = 4.dp), color = if (picked) theme.text else theme.textSecondary,
                style = argusFont(12, FontWeight.Medium),
              )
            }
          }
        }
        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
      }
    }
  }
}

@Composable
private fun Swatch(color: Color, picked: Boolean) {
  val ring = ArgusTheme.colors.text.copy(alpha = 0.85f)
  Canvas(Modifier.size(38.dp)) {
    val r = 15.dp.toPx()
    // `Color.gradient`: a touch lighter at the top.
    drawCircle(Brush.verticalGradient(listOf(color.copy(alpha = 0.85f).compositeOverWhite(), color)), r)
    if (picked) drawCircle(ring, r + 4.dp.toPx() - 0.75.dp.toPx(), style = androidx.compose.ui.graphics.drawscope.Stroke(1.5.dp.toPx()))
  }
}

private fun Color.compositeOverWhite(): Color = androidx.compose.ui.graphics.lerp(this, Color.White, 0.12f).copy(alpha = 1f)

/** Diagonal stripes in a colour over a faint wash of itself: part of a bar about to change. */
@Composable
fun HatchedFill(color: Color, modifier: Modifier = Modifier, spacing: Dp = 5.dp, width: Dp = 2.dp) {
  Canvas(modifier.clearAndSetSemantics {}) {
    drawRect(color.copy(alpha = 0.25f))
    clipRect {
      val step = spacing.toPx()
      var x = -size.height
      while (x < size.width) {
        drawLine(color, Offset(x, size.height), Offset(x + size.height, 0f), strokeWidth = width.toPx())
        x += step
      }
    }
  }
}
