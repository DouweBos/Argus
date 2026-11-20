package dev.houwert.argus.core.usage

import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimits
import dev.houwert.argus.kit.protocol.generated.ClaudeAccountLimitsStatus
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageLimits
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummary
import dev.houwert.argus.kit.protocol.generated.ClaudeUsageSummaryBucket
import dev.houwert.argus.kit.protocol.generated.UsageCostTotals
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindow
import dev.houwert.argus.kit.protocol.generated.UsageLimitWindowKind
import dev.houwert.argus.kit.protocol.generated.UsageListPrice
import dev.houwert.argus.kit.protocol.generated.UsageModelRow
import dev.houwert.argus.kit.protocol.generated.UsageModelRowPriceSource
import dev.houwert.argus.kit.protocol.generated.UsagePriceOverride
import dev.houwert.argus.kit.protocol.generated.UsagePrices
import dev.houwert.argus.kit.protocol.generated.UsageRange
import dev.houwert.argus.kit.protocol.generated.UsageSpeed
import dev.houwert.argus.kit.protocol.generated.UsageSpeedRow
import dev.houwert.argus.kit.protocol.generated.UsageTokenTotals
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UsagePoolTest {
  private val now = 1_000_000_000L

  private fun window(id: String, kind: UsageLimitWindowKind, used: Double, resetsIn: Double?) =
    UsageLimitWindow(id, kind, id, used, resetsAt = resetsIn?.let { now + it })

  private fun account(id: String, vararg windows: UsageLimitWindow) =
    UsagePoolAccount(id, id.replaceFirstChar { it.uppercase() }, "max", windows.toList())

  @Test fun aSingleAccountIsNotPooled() {
    assertNull(UsagePooling.pool("claude", "Claude", listOf(account("a", window("five_hour", UsageLimitWindowKind.session, 10.0, 1.0))), now))
  }

  @Test fun accountsOrderBySessionResetAndLeftAverages() {
    val pool = assertNotNull(
      UsagePooling.pool(
        "claude", "Claude",
        listOf(
          account("late", window("five_hour", UsageLimitWindowKind.session, 80.0, 9000.0), window("seven_day", UsageLimitWindowKind.weekly, 20.0, 90_000.0)),
          account("soon", window("five_hour", UsageLimitWindowKind.session, 40.0, 1000.0)),
          account("none", window("seven_day", UsageLimitWindowKind.weekly, 50.0, null)),
        ),
        now,
      )
    )
    assertEquals(listOf("soon", "late", "none"), pool.accounts.map { it.id })
    assertEquals(listOf("five_hour", "seven_day"), pool.cards.map { it.id })
    val session = pool.cards[0]
    // (60 + 20) / 2 reporting accounts; the third is a gap.
    assertEquals(40, session.percentLeft)
    assertEquals(listOf("soon", "late", "none"), session.segments.map { it.account.id })
    assertNull(session.segments[2].window)
    assertEquals("soon", session.nextReset?.account?.id)
    assertEquals(20, session.nextReset?.restoresPercent)
    assertEquals(listOf(true, false, false), session.segments.map { it.restoresNext })
    val weekly = pool.cards[1]
    assertEquals(65, weekly.percentLeft)
    assertNull(weekly.segments[0].window)
    assertEquals("late", weekly.nextReset?.account?.id)
  }

  @Test fun aSpentWeekLeavesNothingInTheSession() {
    val pool = assertNotNull(
      UsagePooling.pool(
        "claude", "Claude",
        listOf(
          account("spent", window("five_hour", UsageLimitWindowKind.session, 0.0, 100.0), window("seven_day", UsageLimitWindowKind.weekly, 100.0, 5000.0)),
          account("fresh", window("five_hour", UsageLimitWindowKind.session, 50.0, 200.0)),
        ),
        now,
      )
    )
    val session = pool.cards[0]
    assertEquals(25, session.percentLeft)
    assertTrue(session.segments[0].blockedByWeekly)
    assertEquals(1.0, session.segments[0].usedFraction)
    // The spent account's reset gives nothing back, so the next one that does is shown.
    assertEquals("fresh", session.nextReset?.account?.id)
    assertEquals(25, session.nextReset?.restoresPercent)
  }

  @Test fun claudePoolsOnlyAccountsThatReported() {
    val limits = ClaudeUsageLimits(
      listOf(
        ClaudeAccountLimits("a", "A", ClaudeAccountLimitsStatus.ok, windows = listOf(window("five_hour", UsageLimitWindowKind.session, 1.0, 1.0)), checkedAt = 1.0),
        ClaudeAccountLimits("b", "B", ClaudeAccountLimitsStatus.failed, windows = emptyList(), checkedAt = 1.0),
      )
    )
    assertNull(UsagePooling.claude(limits, now))
  }
}

class UsageModelFormatTest {
  @Test fun cacheHitRateIsReadsOverAllInput() {
    assertEquals(0.8, UsageModelFormat.cacheHitRate(UsageTokenTotals(100.0, 10.0, 80.0, 10.0, 0.0)))
    assertNull(UsageModelFormat.cacheHitRate(UsageTokenTotals(5.0, 0.0, 0.0, 0.0, 5.0)))
    assertNull(UsageModelFormat.cacheHitRate(null))
  }

  @Test fun costPerMillionNeedsAPrice() {
    assertEquals(1.5, UsageModelFormat.costPerMillion(UsageModelRow("m", 2_000_000.0, 3.0, true)))
    val unpriced = UsageModelRow("m", 2_000_000.0, 0.0, false, priceSource = UsageModelRowPriceSource.none)
    assertNull(UsageModelFormat.costPerMillion(unpriced))
    assertTrue(UsageModelFormat.isUnpriced(unpriced))
  }

  @Test fun speedsShowOnlyWithAFasterTier() {
    fun summary(speeds: List<UsageSpeedRow>) = ClaudeUsageSummary(
      UsageRange._7d, 0.0, 1.0, ClaudeUsageSummaryBucket.day, 1.0, UsageTokenTotals(1.0, 1.0, 0.0, 0.0, 0.0),
      UsageCostTotals(4.0, 4.0, 0.0, 0.0, 0.0, premium = 1.0), 0.0, emptyList(), emptyList(), speeds = speeds,
    )
    assertTrue(UsageSummaryFormat.bySpeed(summary(listOf(UsageSpeedRow(UsageSpeed.standard, 1.0, 4.0, 0.0))), UsageMetric.Cost).isEmpty())
    val rows = UsageSummaryFormat.bySpeed(
      summary(listOf(UsageSpeedRow(UsageSpeed.standard, 1.0, 3.0, 0.0), UsageSpeedRow(UsageSpeed.fast, 1.0, 1.0, 1.0))), UsageMetric.Cost,
    )
    assertEquals(listOf("Standard", "Fast"), rows.map { it.label })
    assertEquals(0.25, rows[1].share)
    assertEquals(1.0, UsageSummaryFormat.premium(summary(emptyList())))
  }
}

class UsagePriceDraftTest {
  private val prices = UsagePrices(
    overrides = listOf(UsagePriceOverride("custom-1", 1.5, 6.0), UsagePriceOverride("alias", mapTo = "claude-opus-5-5")),
    list = listOf(UsageListPrice("claude-opus-5-5", 5.0, 25.0, 0.5, 6.25), UsageListPrice("custom-1", 2.0, 8.0, 0.2, 2.5)),
  )

  @Test fun overridesComeFirstThenListModels() {
    val draft = UsagePriceDraft(prices)
    assertEquals(listOf("custom-1", "alias", "claude-opus-5-5"), draft.rows.map { it.model })
    assertEquals("1.5", draft["custom-1"]?.input)
    assertEquals(2.0, draft["custom-1"]?.list?.input)
    assertFalse(draft.isDirty)
  }

  @Test fun addingAModelPutsItOnTop() {
    val draft = UsagePriceDraft(prices, adding = "local-llama")
    assertEquals("local-llama", draft.rows.first().model)
    assertNull(draft.adding("alias"))
    assertTrue(draft.isDirty)
  }

  @Test fun resetDropsTheOverrideUntilUndone() {
    var draft = UsagePriceDraft(prices).togglingReset("custom-1")
    assertEquals(listOf("alias"), draft.overrides().getOrThrow().map { it.model })
    draft = draft.togglingReset("custom-1")
    val saved = draft.overrides().getOrThrow()
    assertEquals(listOf("custom-1", "alias"), saved.map { it.model })
    assertNull(saved[0].cacheReadPerMtok)
    assertEquals("claude-opus-5-5", saved[1].mapTo)
    assertNull(saved[1].inputPerMtok)
  }

  @Test fun aBadNumberSaysWhichField() {
    val draft = UsagePriceDraft(prices).updating("claude-opus-5-5") { it.copy(output = "lots") }
    val error = assertIs<UsagePriceDraft.DraftError>(draft.overrides().exceptionOrNull())
    assertEquals("claude-opus-5-5: the output price isn't a number.", error.message)
  }

  @Test fun pricesReadWithoutTrailingZeros() {
    assertEquals("3", UsagePriceDraft.text(3.0))
    assertEquals("0.3", UsagePriceDraft.text(0.3))
    assertEquals("", UsagePriceDraft.text(null))
  }
}
