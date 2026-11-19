package dev.houwert.argus.ui.usage

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.usage.UsageLevel
import dev.houwert.argus.core.usage.UsageModelKey
import dev.houwert.argus.core.usage.UsageTab
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.delay

/**
 * How Usage opens a model's detail, the price editor and the counted models: the phone pushes
 * onto its stack. Unset, rows don't open anything.
 */
class UsageNavigation(
  /** A model under Cost or Tokens, over the range on screen. */
  val openModel: (UsageModelKey, UsageTab, UsageRange) -> Unit,
  /** Opens the price editor, adding this model when one is given. */
  val openPrices: (String?) -> Unit,
  /** Opens which models Usage counts or leaves out. */
  val openCountedModels: () -> Unit,
)

val LocalUsageNavigation = staticCompositionLocalOf<UsageNavigation?> { null }

/** The wall clock, ticking every [everyMs] so countdowns move while the screen sits open. */
@Composable
fun rememberNow(everyMs: Long = 30_000): State<Long> =
  produceState(System.currentTimeMillis()) {
    while (true) {
      delay(everyMs)
      value = System.currentTimeMillis()
    }
  }

internal fun UsageLevel.tone(): Tone = when (this) {
  UsageLevel.Normal -> Tone.Accent
  UsageLevel.Warning -> Tone.Warning
  UsageLevel.Critical -> Tone.Danger
}

/** A rounded bar filled with the used share; the track is the theme's hover tint. */
@Composable
fun UsageBar(fraction: Double, tone: Tone, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  Box(modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(theme.bgHover).clearAndSetSemantics {}) {
    Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.toFloat().coerceIn(0f, 1f)).clip(CircleShape).background(tone.color(theme)))
  }
}

/** "Resets in 2h" as the tail of a sentence: "resets in 2h". */
internal fun String.lowercaseFirst(): String = replaceFirstChar { it.lowercase() }

/** Runners' messages carry code spans ("Run `codex login`"); those read as monospace. */
internal fun inlineCode(source: String): AnnotatedString = buildAnnotatedString {
  source.split('`').forEachIndexed { index, part ->
    if (index % 2 == 1) withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(part) } else append(part)
  }
}

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
internal fun agoLabel(thenMs: Double, nowMs: Long): String {
  val minutes = ((nowMs - thenMs) / 60_000).toLong()
  return when {
    minutes < 1 -> "just now"
    minutes < 60 -> "$minutes min ago"
    minutes < 1440 -> "${minutes / 60} h ago"
    else -> "${minutes / 1440} d ago"
  }
}
