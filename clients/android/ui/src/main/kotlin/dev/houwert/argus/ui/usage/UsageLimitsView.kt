package dev.houwert.argus.ui.usage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.usage.UsageLimitFormat
import dev.houwert.argus.core.usage.UsagePooling
import dev.houwert.argus.core.usage.loadUsageLimits
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimits
import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimitsStatus
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.protocol.generated.RunnerUsageLimitsStatus
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.Card
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.Screen
import dev.houwert.argus.ui.components.SectionHeader
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.launch

/** Plan limits for every account and runner on the host, polled every minute; a pull or Retry skips the host's cache. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HostUsageLimitsView(host: HostStore, modifier: Modifier = Modifier) {
  val limits by host.usageLimits.collectAsState()
  val error by host.usageLimitsError.collectAsState()
  val loading by host.usageLimitsLoading.collectAsState()
  val connection by host.connection.collectAsState()
  val scope = rememberCoroutineScope()
  LiveRefresh(enabled = connection == Transport.State.Ready, interval = 60.seconds) { host.loadUsageLimits() }
  PullToRefreshBox(
    isRefreshing = loading && limits != null,
    onRefresh = { scope.launch { host.loadUsageLimits(refresh = true) } },
    modifier = modifier.fillMaxSize(),
  ) {
    UsageLimitsView(limits, error, loading) { scope.launch { host.loadUsageLimits(refresh = true) } }
  }
}

/**
 * Plan limits per Claude account (pooled when there are several), then per runner. Claude's group
 * is only named alongside others, since a lone header repeats the screen title.
 */
@Composable
fun UsageLimitsView(
  limits: ClaudeUsageLimits?,
  error: String?,
  loading: Boolean,
  modifier: Modifier = Modifier,
  nowMs: Long = rememberNow().value,
  onRetry: () -> Unit,
) {
  when {
    limits != null && limits.accounts.isEmpty() && limits.runners.isNullOrEmpty() ->
      EmptyState(
        Icon.person, "No plan limits", modifier,
        body = "Sign in to Claude Code, Codex or another agent on the computer to see its plan limits.",
      )
    limits != null -> Screen(modifier) { LimitsContent(limits, error, nowMs, onRetry) }
    error != null ->
      EmptyState(Icon.warning, "Couldn't load plan limits", modifier, body = error, selectable = true) {
        Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, icon = Icon.refresh, enabled = !loading, onClick = onRetry)
      }
    else -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Loading("Checking plan limits") }
  }
}

@Composable
private fun ColumnScope.LimitsContent(limits: ClaudeUsageLimits, error: String?, nowMs: Long, onRetry: () -> Unit) {
  val theme = ArgusTheme.colors
  val runners = limits.runners.orEmpty()
  if (error != null) Banner(error, tone = Tone.Danger, actionLabel = "Retry", onAction = onRetry)
  // Several accounts pool into one card per window; the ones that failed keep their own.
  val pool = UsagePooling.claude(limits, nowMs)
  if (pool != null) {
    UsagePoolSection(pool, nowMs)
    Accounts(limits.accounts.filter { it.status != ClaudeAccountLimitsStatus.ok }, named = true, byName = true, nowMs, onRetry)
  } else {
    Accounts(limits.accounts, named = limits.accounts.size > 1 || runners.isNotEmpty(), byName = limits.accounts.size > 1, nowMs, onRetry)
  }
  for (runner in runners) {
    LimitsHeader(runner.label, runner.plan)
    Card {
      LimitsBody(
        state = LimitsState.of(runner.status == RunnerUsageLimitsStatus.ok, runner.status == RunnerUsageLimitsStatus.failed),
        windows = runner.windows, nowMs = nowMs,
        failure = runner.message ?: "Couldn't read ${runner.label}'s limits.",
        empty = runner.message ?: "No plan limits", onRetry = onRetry,
      )
    }
  }
  val checked = UsageLimitFormat.checkedAt(limits)
  if (checked != null && checked > 0) {
    Text("Checked ${agoLabel(checked, nowMs)}", color = theme.textMuted, style = argusFont(12))
  }
}

@Composable
private fun Accounts(accounts: List<ClaudeAccountLimits>, named: Boolean, byName: Boolean, nowMs: Long, onRetry: () -> Unit) {
  for (account in accounts) {
    if (named) LimitsHeader(if (byName) account.label else "Claude", account.subscriptionType)
    Card {
      LimitsBody(
        state = LimitsState.of(account.status == ClaudeAccountLimitsStatus.ok, account.status == ClaudeAccountLimitsStatus.failed),
        windows = account.windows, nowMs = nowMs,
        failure = "Couldn't read this account's limits.",
        empty = account.message ?: "No plan limits for this account", onRetry = onRetry,
      )
    }
  }
}

@Composable
internal fun LimitsHeader(title: String, plan: String?) {
  Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
    SectionHeader(title, Modifier.weight(1f, fill = false))
    if (!plan.isNullOrEmpty()) Badge(plan.replaceFirstChar { it.uppercase() })
  }
}

private enum class LimitsState {
  Ok, Failed, Unsupported;

  companion object {
    fun of(ok: Boolean, failed: Boolean) = if (ok) Ok else if (failed) Failed else Unsupported
  }
}

/** An account's or a runner's card: its meters, why it failed, or why there is nothing to show. */
@Composable
private fun LimitsBody(
  state: LimitsState,
  windows: List<UsageLimitWindow>,
  nowMs: Long,
  failure: String,
  empty: String,
  onRetry: () -> Unit,
) {
  val theme = ArgusTheme.colors
  when {
    state == LimitsState.Ok && windows.isNotEmpty() -> UsageMeterRows(windows, nowMs)
    state == LimitsState.Failed ->
      Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(inlineCode(failure), Modifier.weight(1f), color = theme.error, style = argusFont(13))
        Btn("Retry", tone = ButtonTone.Secondary, small = true, hugs = true, onClick = onRetry)
      }
    else -> Text(inlineCode(empty), color = theme.textMuted, style = argusFont(13))
  }
}

/** Windows as full meters, a hairline between each. */
@Composable
internal fun UsageMeterRows(windows: List<UsageLimitWindow>, nowMs: Long) {
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    windows.forEachIndexed { index, window ->
      if (index > 0) HorizontalDivider(color = ArgusTheme.colors.borderSubtle)
      UsageMeterRow(window, nowMs)
    }
  }
}

/** One plan window: what is left, a bar of what is used, when it resets and how the pace looks. */
@Composable
fun UsageMeterRow(window: UsageLimitWindow, nowMs: Long, modifier: Modifier = Modifier) {
  val theme = ArgusTheme.colors
  val tone = UsageLimitFormat.level(window.usedPercent).tone()
  val left = UsageLimitFormat.percentLeft(window.usedPercent)
  val reset = UsageLimitFormat.resetCaption(window.resetsAt, nowMs)
  val pace = UsageLimitFormat.paceCaption(window.pace)
  Column(modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(window.label, color = theme.textSecondary, style = argusFont(13, FontWeight.Medium))
    Text(
      "$left% left", color = if (tone == Tone.Accent) theme.text else tone.color(theme),
      style = argusFont(22, FontWeight.SemiBold).copy(fontFeatureSettings = "tnum"),
    )
    UsageBar(UsageLimitFormat.fraction(window.usedPercent), tone)
    if (reset != null || pace != null) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(reset ?: "", Modifier.weight(1f), color = theme.textMuted, style = argusFont(12))
        if (pace != null) Text(pace, color = theme.textMuted, style = argusFont(12))
      }
    }
  }
}
