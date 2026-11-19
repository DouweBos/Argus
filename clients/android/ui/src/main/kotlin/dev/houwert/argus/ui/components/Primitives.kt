package dev.houwert.argus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

// Typography

@Composable
fun TitleText(text: String, modifier: Modifier = Modifier) {
  Text(text, modifier, color = ArgusTheme.colors.text, style = argusFont(19, FontWeight.Bold))
}

@Composable
fun BodyText(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
  Text(
    text, modifier, color = ArgusTheme.colors.text, style = argusFont(15), maxLines = maxLines,
    overflow = TextOverflow.Ellipsis,
  )
}

@Composable
fun MutedText(text: String, modifier: Modifier = Modifier, maxLines: Int = Int.MAX_VALUE) {
  Text(
    text, modifier, color = ArgusTheme.colors.textMuted, style = argusFont(13), maxLines = maxLines,
    overflow = TextOverflow.Ellipsis,
  )
}

/**
 * Monospaced text. Paths truncate at the head (`truncateHead`): when one is too long, the
 * filename is the part worth keeping.
 */
@Composable
fun MonoText(
  text: String,
  modifier: Modifier = Modifier,
  size: Int = 12,
  color: Color? = null,
  maxLines: Int = Int.MAX_VALUE,
  truncateHead: Boolean = false,
) {
  Text(
    text,
    modifier,
    color = color ?: ArgusTheme.colors.textSecondary,
    style = argusFont(size, mono = true),
    maxLines = maxLines,
    overflow = if (truncateHead) TextOverflow.StartEllipsis else TextOverflow.Ellipsis,
  )
}

// Containers

/** A scrolling screen body with the standard padding and background, capped on a tablet. */
@Composable
fun Screen(
  modifier: Modifier = Modifier,
  scroll: Boolean = true,
  content: @Composable ColumnScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  Box(modifier.fillMaxSize().background(theme.bg), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = ArgusMetrics.maxReadingWidth)
        .fillMaxWidth()
        .then(if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier)
        .padding(ArgusMetrics.space),
      verticalArrangement = Arrangement.spacedBy(ArgusMetrics.space),
      content = content,
    )
  }
}

/** A raised, rounded surface; tappable with `onClick`, its outline tinted by `tone`. */
@Composable
fun Card(
  modifier: Modifier = Modifier,
  tone: Tone? = null,
  onClick: (() -> Unit)? = null,
  content: @Composable ColumnScope.() -> Unit,
) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radius)
  val interaction = rememberInteraction()
  Column(
    modifier
      .fillMaxWidth()
      .cardSurface(stroke = tone?.color(theme)?.copy(alpha = 0.5f))
      .then(if (onClick != null) Modifier.argusClickable(interaction, shape = shape, onClick = onClick) else Modifier)
      .padding(ArgusMetrics.space),
    verticalArrangement = Arrangement.spacedBy(8.dp),
    content = content,
  )
}

/** A section's sentence-case muted title, with an optional count. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, count: Int? = null) {
  val theme = ArgusTheme.colors
  Row(
    modifier.fillMaxWidth().padding(top = 4.dp).semantics { heading() },
    horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Text(title, color = theme.textMuted, style = SectionHeaderFont)
    if (count != null) Text("$count", color = theme.textMuted.copy(alpha = theme.textMuted.alpha * 0.7f), style = SectionHeaderFont)
  }
}

internal val SectionHeaderFont = argusFont(13, FontWeight.SemiBold)

/** A labelled settings card with an optional explanatory caption. */
@Composable
fun Field(
  label: String,
  modifier: Modifier = Modifier,
  caption: String? = null,
  content: @Composable ColumnScope.() -> Unit,
) {
  Column(
    modifier.fillMaxWidth().cardSurface().padding(ArgusMetrics.space),
    verticalArrangement = Arrangement.spacedBy(8.dp),
  ) {
    Text(label, color = ArgusTheme.colors.textMuted, style = SectionHeaderFont)
    content()
    if (caption != null) MutedText(caption)
  }
}

/** `Card` and `Field`'s surface: a hairline, or a 1dp tinted outline. */
@Composable
internal fun Modifier.cardSurface(stroke: Color? = null): Modifier {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radius)
  return clip(shape).background(theme.bgSecondary).border(if (stroke == null) 0.5.dp else 1.dp, stroke ?: theme.border, shape)
}

/** A padded card for forms and summaries (`.card()`). */
@Composable
fun Modifier.card(padding: Dp = 12.dp): Modifier {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(ArgusMetrics.radius)
  return clip(shape).background(theme.bgSecondary).border(0.5.dp, theme.border, shape).padding(padding)
}

/** A card without padding, for lists and diffs that run to its edges (`.panel()`). */
@Composable
fun Modifier.panel(): Modifier = card(padding = 0.dp)
