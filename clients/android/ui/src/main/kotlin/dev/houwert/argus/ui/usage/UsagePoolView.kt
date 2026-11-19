package dev.houwert.argus.ui.usage

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.usage.UsageLimitFormat
import dev.houwert.argus.core.usage.UsagePool
import dev.houwert.argus.core.usage.UsagePoolAccount
import dev.houwert.argus.core.usage.UsagePoolCard
import dev.houwert.argus.core.usage.UsagePoolSegment
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.HatchedFill
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont

/** A provider with several accounts: a card per window with what's left of the pool, then a row per account that expands into its meters. */
@Composable
internal fun UsagePoolSection(pool: UsagePool, nowMs: Long) {
  var expanded by remember { mutableStateOf(emptySet<String>()) }
  Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
    SectionHeader(pool.label, Modifier.weight(1f, fill = false))
    Badge("${pool.accounts.size} accounts")
  }
  AdaptiveGrid(pool.cards, minWidth = 260.dp) { card ->
    Card { PoolCardBody(card, nowMs) { expanded = expanded + it } }
  }
  Card {
    pool.accounts.forEachIndexed { index, account ->
      if (index > 0) HorizontalDivider(color = ArgusTheme.colors.borderSubtle)
      val open = account.id in expanded
      AccountRow(account, open, nowMs) { expanded = if (open) expanded - account.id else expanded + account.id }
      AnimatedVisibility(open) { PoolAccountDetail(account, nowMs) }
    }
  }
}

@Composable
private fun AccountRow(account: UsagePoolAccount, expanded: Boolean, nowMs: Long, onToggle: () -> Unit) {
  val theme = ArgusTheme.colors
  val turn by animateFloatAsState(if (expanded) 90f else 0f, label = "chevron")
  Row(
    Modifier.fillMaxWidth()
      .argusClickable(rememberInteraction(), shape = RoundedCornerShape(ArgusMetrics.radiusSmall), role = Role.Button, label = account.label, onClick = onToggle)
      .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }
      .padding(vertical = 6.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(Icon.person, null, Modifier.size(18.dp), tint = theme.textMuted)
    Text(account.label, color = theme.text, style = argusFont(13, FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
    if (!account.plan.isNullOrEmpty()) Badge(account.plan!!.replaceFirstChar { it.uppercase() })
    Box(Modifier.weight(1f))
    val caption = UsageLimitFormat.resetCaption(account.sessionResetsAt, nowMs)
    if (!expanded && caption != null) {
      Text("Session · ${caption.lowercaseFirst()}", color = theme.textMuted, style = argusFont(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Icon(Icon.chevronRight, null, Modifier.size(16.dp).rotate(turn), tint = theme.textMuted)
  }
}

/** One window across the pool: what's left, a segment per account, the next reset. */
@Composable
private fun PoolCardBody(card: UsagePoolCard, nowMs: Long, onSelect: (String) -> Unit) {
  val theme = ArgusTheme.colors
  val tone = card.level.tone()
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(card.label, color = theme.textSecondary, style = argusFont(13, FontWeight.Medium))
    Text(
      "${card.percentLeft}% left", color = if (tone == Tone.Accent) theme.text else tone.color(theme),
      style = argusFont(22, FontWeight.SemiBold).copy(fontFeatureSettings = "tnum"),
    )
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
      for (segment in card.segments) {
        UsagePoolSegmentBar(
          segment,
          Modifier.weight(1f)
            .argusClickable(rememberInteraction(), shape = RoundedCornerShape(3.dp), label = segmentLabel(segment)) { onSelect(segment.account.id) }
            .semantics { contentDescription = segmentLabel(segment) },
        )
      }
    }
    Text(poolCaption(card, nowMs), color = theme.textMuted, style = argusFont(12))
  }
}

private fun poolCaption(card: UsagePoolCard, nowMs: Long): String {
  val pool = "Pool of ${card.segments.count { it.window != null }} accounts"
  val next = card.nextReset ?: return pool
  val countdown = UsageLimitFormat.countdown(next.resetsAt, nowMs) ?: return pool
  return "Next reset in $countdown gives back ${next.restoresPercent}% · ${next.account.label}"
}

private fun segmentLabel(segment: UsagePoolSegment): String {
  val window = segment.window ?: return "${segment.account.label}: not reported"
  val left = if (segment.blockedByWeekly) 0 else UsageLimitFormat.percentLeft(window.usedPercent)
  return "${segment.account.label}: $left% left"
}

/** One account's part of a pooled bar: its used share filled, hatched when the next reset gives it back, dashed where it doesn't report the window. */
@Composable
fun UsagePoolSegmentBar(segment: UsagePoolSegment, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val shape = RoundedCornerShape(3.dp)
  val tone = UsageLimitFormat.level(segment.usedFraction * 100).tone()
  Box(modifier.height(10.dp).clip(shape)) {
    if (segment.window == null) {
      val border = theme.border
      Canvas(Modifier.fillMaxSize()) {
        drawRoundRect(
          border, cornerRadius = CornerRadius(3.dp.toPx()),
          style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(3.dp.toPx(), 2.dp.toPx()))),
        )
      }
    } else {
      Box(Modifier.fillMaxSize().background(theme.bgHover))
      val fill = Modifier.fillMaxHeight().fillMaxWidth(segment.usedFraction.toFloat().coerceIn(0f, 1f))
      if (segment.restoresNext) HatchedFill(tone.color(theme), fill) else Box(fill.background(tone.color(theme)))
    }
  }
}

/** An expanded account: each window's full meter, pace included. */
@Composable
private fun PoolAccountDetail(account: UsagePoolAccount, nowMs: Long) {
  val theme = ArgusTheme.colors
  Column(
    Modifier.fillMaxWidth().padding(bottom = 6.dp).border(BorderStroke(1.dp, theme.borderSubtle), RoundedCornerShape(8.dp)).padding(12.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (account.weeklySpent) {
      Text("No weekly quota left, so its session has nothing to give until the week resets.", color = theme.warning, style = argusFont(12))
    }
    UsageMeterRows(account.windows, nowMs)
  }
}

/** Items in as many equal columns of at least [minWidth] as fit. */
@Composable
internal fun <T> AdaptiveGrid(items: List<T>, minWidth: Dp, spacing: Dp = ArgusMetrics.space, content: @Composable (T) -> Unit) {
  BoxWithConstraints(Modifier.fillMaxWidth()) {
    val columns = ((maxWidth + spacing) / (minWidth + spacing)).toInt().coerceAtLeast(1)
    Column(verticalArrangement = Arrangement.spacedBy(spacing)) {
      for (row in items.chunked(columns)) {
        Row(horizontalArrangement = Arrangement.spacedBy(spacing)) {
          for (item in row) Box(Modifier.weight(1f)) { content(item) }
          repeat(columns - row.size) { Box(Modifier.weight(1f)) }
        }
      }
    }
  }
}
