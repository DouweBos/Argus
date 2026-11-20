package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimitsStatus
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindowKind
import kotlin.math.floor
import kotlin.math.roundToInt

/** One signed-in account of a provider, as a pool sees it. */
data class UsagePoolAccount(val id: String, val label: String, val plan: String?, val windows: List<UsageLimitWindow>) {
  /** When its session window next resets, epoch ms. */
  val sessionResetsAt: Double? get() = windows.firstOrNull { it.kind == UsageLimitWindowKind.session }?.resetsAt

  /** Its account-wide weekly cap is spent, so its session has nothing to give. */
  val weeklySpent: Boolean get() = (windows.firstOrNull { it.kind == UsageLimitWindowKind.weekly }?.usedPercent ?: 0.0) >= 100
}

/** One account's part of a pooled window; `window` null is a gap. */
data class UsagePoolSegment(
  val account: UsagePoolAccount,
  val window: UsageLimitWindow?,
  /** 0-1 of the segment that is used, counting a spent weekly cap as all of a session. */
  val usedFraction: Double,
  /** The next reset in this window lands on this segment and restores its used part. */
  val restoresNext: Boolean,
  /** Used up by the weekly cap rather than by this window. */
  val blockedByWeekly: Boolean,
) {
  val id: String get() = account.id
}

/** One window id across every account of a provider. */
data class UsagePoolCard(
  val id: String,
  val label: String,
  val segments: List<UsagePoolSegment>,
  /** 0-100: the left of the accounts reporting this window, averaged. */
  val percentLeft: Int,
  /** The soonest reset that gives anything back, and how many pool points it returns. */
  val nextReset: NextReset?,
) {
  data class NextReset(val account: UsagePoolAccount, val resetsAt: Double, val restoresPercent: Int)

  val level: UsageLevel get() = UsageLimitFormat.level((100 - percentLeft).toDouble())
}

/** A provider with several accounts, pooled: a card per window, accounts soonest session reset first. */
data class UsagePool(val id: String, val label: String, val accounts: List<UsagePoolAccount>, val cards: List<UsagePoolCard>)

object UsagePooling {
  /** Null with fewer than two accounts: a single account keeps per-window meters. */
  fun pool(id: String, label: String, accounts: List<UsagePoolAccount>, nowMs: Long): UsagePool? {
    val reporting = accounts.filter { it.windows.isNotEmpty() }
    if (reporting.size < 2) return null
    // Stable sort: accounts without a session reset keep their order after the rest.
    val ordered = reporting.sortedWith(compareBy(nullsLast()) { it.sessionResetsAt })
    val ids = linkedMapOf<String, String>()
    for (window in ordered.flatMap { it.windows }) ids.putIfAbsent(window.id, window.label)
    return UsagePool(id, label, ordered, ids.map { (windowId, windowLabel) -> card(windowId, windowLabel, ordered, nowMs.toDouble()) })
  }

  /** Claude's accounts with limits, pooled; null with fewer than two. */
  fun claude(limits: ClaudeUsageLimits?, nowMs: Long): UsagePool? {
    val accounts = limits?.accounts.orEmpty().filter { it.status == ClaudeAccountLimitsStatus.ok }
      .map { UsagePoolAccount(it.accountId, it.label, it.subscriptionType, it.windows) }
    return pool("claude", "Claude", accounts, nowMs)
  }

  private fun card(id: String, label: String, accounts: List<UsagePoolAccount>, nowMs: Double): UsagePoolCard {
    val found = accounts.map { account -> account to account.windows.firstOrNull { it.id == id } }
    fun blocked(account: UsagePoolAccount, window: UsageLimitWindow) = window.kind == UsageLimitWindowKind.session && account.weeklySpent
    fun used(account: UsagePoolAccount, window: UsageLimitWindow) =
      if (blocked(account, window)) 1.0 else UsageLimitFormat.fraction(window.usedPercent)
    val present = found.mapNotNull { (account, window) -> window?.let { account to it } }
    val left = present.sumOf { (account, window) -> 1 - used(account, window) }
    val percentLeft = if (present.isEmpty()) 0 else floor(left / present.size * 100).toInt()
    val next = present
      .filter { (account, window) -> !blocked(account, window) && window.usedPercent > 0 && (window.resetsAt ?: 0.0) > nowMs }
      .minByOrNull { it.second.resetsAt ?: 0.0 }
    val nextReset = next?.let { (account, window) ->
      UsagePoolCard.NextReset(account, window.resetsAt ?: 0.0, (used(account, window) / present.size * 100).roundToInt())
    }
    val segments = found.map { (account, window) ->
      UsagePoolSegment(
        account, window, window?.let { used(account, it) } ?: 0.0,
        restoresNext = next?.first?.id == account.id && window != null,
        blockedByWeekly = window?.let { blocked(account, it) } ?: false,
      )
    }
    return UsagePoolCard(id, label, segments, percentLeft, nextReset)
  }
}
