package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimits
import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimitsStatus
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.protocol.generated.RunnerUsageLimits
import dev.houwert.argus.kit.protocol.generated.RunnerUsageLimitsStatus
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindowKind
import dev.houwert.argus.kit.protocol.generated.UsagePace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UsageLimitFormatTest {
  private val now = 1_000_000_000L
  private fun ms(inSeconds: Double) = now + inSeconds * 1000

  // The bar fills with what is used; a full bar means the limit is spent.
  @Test fun barFillsWithTheUsedShare() {
    assertEquals(0.0, UsageLimitFormat.fraction(0.0))
    assertEquals(0.53, UsageLimitFormat.fraction(53.0))
    assertEquals(1.0, UsageLimitFormat.fraction(120.0))
  }

  @Test fun percentLeftRoundsDownAndClamps() {
    assertEquals(100, UsageLimitFormat.percentLeft(0.0))
    assertEquals(99, UsageLimitFormat.percentLeft(0.4))
    assertEquals(63, UsageLimitFormat.percentLeft(37.0))
    assertEquals(0, UsageLimitFormat.percentLeft(120.0))
    assertEquals(100, UsageLimitFormat.percentLeft(-5.0))
    assertEquals(1, UsageLimitFormat.percentUsed(0.4))
  }

  @Test fun levelCrossesAtEightyAndNinetyFive() {
    assertEquals(UsageLevel.Normal, UsageLimitFormat.level(80.0))
    assertEquals(UsageLevel.Warning, UsageLimitFormat.level(80.5))
    assertEquals(UsageLevel.Warning, UsageLimitFormat.level(95.0))
    assertEquals(UsageLevel.Critical, UsageLimitFormat.level(96.0))
  }

  @Test fun countdownPicksTheTwoLargestUnits() {
    assertEquals("4h 29m", UsageLimitFormat.countdown(ms(4 * 3600 + 29 * 60 + 30.0), now))
    assertEquals("5d 1h", UsageLimitFormat.countdown(ms(5 * 86400 + 3600 + 120.0), now))
    assertEquals("12m", UsageLimitFormat.countdown(ms(12 * 60 + 5.0), now))
    assertEquals("<1m", UsageLimitFormat.countdown(ms(20.0), now))
    assertNull(UsageLimitFormat.countdown(ms(-1.0), now))
  }

  @Test fun resetCaption() {
    assertEquals("Resets in 1h 0m", UsageLimitFormat.resetCaption(ms(3600.0), now))
    assertEquals("Resetting now", UsageLimitFormat.resetCaption(ms(-60.0), now))
    assertNull(UsageLimitFormat.resetCaption(null, now))
  }

  @Test fun paceCaption() {
    assertEquals("Ahead of pace", UsageLimitFormat.paceCaption(UsagePace.ahead))
    assertEquals("On pace", UsageLimitFormat.paceCaption(UsagePace.on))
    assertEquals("Under pace", UsageLimitFormat.paceCaption(UsagePace.under))
    assertNull(UsageLimitFormat.paceCaption(null))
  }

  private fun window(id: String) = UsageLimitWindow(id, UsageLimitWindowKind.session, id, 10.0)
  private fun account(id: String, label: String, checkedAt: Double = 1.0) =
    ClaudeAccountLimits(id, label, ClaudeAccountLimitsStatus.ok, windows = listOf(window("s")), checkedAt = checkedAt)
  private fun runner(id: String, label: String, status: RunnerUsageLimitsStatus, ok: Boolean, checkedAt: Double = 1.0) =
    RunnerUsageLimits(id, label, status, windows = if (ok) listOf(window("s")) else emptyList(), checkedAt = checkedAt)

  @Test fun groupsCoverAccountsAndRunnersWithWindows() {
    val limits = ClaudeUsageLimits(
      listOf(account("a", "Work", 5.0)),
      listOf(
        runner("codex", "Codex", RunnerUsageLimitsStatus.ok, true, 9.0),
        runner("cursor", "Cursor", RunnerUsageLimitsStatus.failed, false, 7.0),
        runner("grok", "Grok", RunnerUsageLimitsStatus.unsupported, false, 3.0),
      ),
    )
    assertEquals(listOf("Claude", "Codex"), UsageLimitFormat.groups(limits).map { it.label })
    assertEquals(9.0, UsageLimitFormat.checkedAt(limits))
    assertTrue(UsageLimitFormat.groups(null).isEmpty())
  }

  @Test fun severalAccountsGoByTheirNames() {
    val limits = ClaudeUsageLimits(listOf(account("a", "Work"), account("b", "Personal")))
    assertEquals(listOf("Work", "Personal"), UsageLimitFormat.groups(limits).map { it.label })
  }

  @Test fun runnerGroupsPickTheAgentsRunner() {
    val limits = ClaudeUsageLimits(listOf(account("a", "Work")), listOf(runner("codex", "Codex", RunnerUsageLimitsStatus.ok, true)))
    assertEquals(listOf("Claude"), UsageLimitFormat.groups(limits, "claude-code").map { it.label })
    assertEquals(listOf("Claude"), UsageLimitFormat.groups(limits, null).map { it.label })
    assertEquals(listOf("Codex"), UsageLimitFormat.groups(limits, "codex").map { it.label })
    assertTrue(UsageLimitFormat.groups(limits, "grok").isEmpty())
  }
}
