import ArgusCore
import ArgusKit
import Foundation
import Testing

struct UsagePoolTests {
  let now = Date(timeIntervalSince1970: 1_000_000)
  var nowMs: Double { now.timeIntervalSince1970 * 1000 }

  func window(_ id: String, _ kind: ArgusProtocol.UsageLimitWindowKind, used: Double, resetsIn: Double?)
    -> ArgusProtocol.UsageLimitWindow
  {
    .init(id: id, kind: kind, label: id, usedPercent: used, resetsAt: resetsIn.map { nowMs + $0 })
  }

  func account(_ id: String, _ windows: [ArgusProtocol.UsageLimitWindow]) -> UsagePoolAccount {
    UsagePoolAccount(id: id, label: id.capitalized, plan: "max", windows: windows)
  }

  @Test func aSingleAccountIsNotPooled() {
    let pool = UsagePooling.pool(
      id: "claude", label: "Claude", accounts: [account("a", [window("five_hour", .session, used: 10, resetsIn: 1)])],
      now: now)
    #expect(pool == nil)
  }

  @Test func accountsOrderBySessionResetAndLeftAverages() throws {
    let pool = try #require(
      UsagePooling.pool(
        id: "claude", label: "Claude",
        accounts: [
          account("late", [window("five_hour", .session, used: 80, resetsIn: 9000), window("seven_day", .weekly, used: 20, resetsIn: 90_000)]),
          account("soon", [window("five_hour", .session, used: 40, resetsIn: 1000)]),
          account("none", [window("seven_day", .weekly, used: 50, resetsIn: nil)]),
        ], now: now))
    #expect(pool.accounts.map(\.id) == ["soon", "late", "none"])
    #expect(pool.cards.map(\.id) == ["five_hour", "seven_day"])
    let session = pool.cards[0]
    // (60 + 20) / 2 reporting accounts; the third is a gap.
    #expect(session.percentLeft == 40)
    #expect(session.segments.map(\.account.id) == ["soon", "late", "none"])
    #expect(session.segments[2].window == nil)
    #expect(session.nextReset?.account.id == "soon")
    #expect(session.nextReset?.restoresPercent == 20)
    #expect(session.segments.map(\.restoresNext) == [true, false, false])
    let weekly = pool.cards[1]
    #expect(weekly.percentLeft == 65)
    #expect(weekly.segments[0].window == nil)
    #expect(weekly.nextReset?.account.id == "late")
  }

  @Test func aSpentWeekLeavesNothingInTheSession() throws {
    let pool = try #require(
      UsagePooling.pool(
        id: "claude", label: "Claude",
        accounts: [
          account("spent", [window("five_hour", .session, used: 0, resetsIn: 100), window("seven_day", .weekly, used: 100, resetsIn: 5000)]),
          account("fresh", [window("five_hour", .session, used: 50, resetsIn: 200)]),
        ], now: now))
    let session = pool.cards[0]
    #expect(session.percentLeft == 25)
    #expect(session.segments[0].blockedByWeekly)
    #expect(session.segments[0].usedFraction == 1)
    // The spent account's reset gives nothing back, so the next one that does is shown.
    #expect(session.nextReset?.account.id == "fresh")
    #expect(session.nextReset?.restoresPercent == 25)
  }

  @Test func claudePoolsOnlyAccountsThatReported() {
    let limits = ArgusProtocol.ClaudeUsageLimits(accounts: [
      .init(accountId: "a", label: "A", status: .ok, windows: [window("five_hour", .session, used: 1, resetsIn: 1)], checkedAt: 1),
      .init(accountId: "b", label: "B", status: .failed, windows: [], checkedAt: 1),
    ])
    #expect(UsagePooling.claude(limits, now: now) == nil)
  }
}

struct UsageModelFormatTests {
  @Test func cacheHitRateIsReadsOverAllInput() {
    let kinds = ArgusProtocol.UsageTokenTotals(processed: 100, input: 10, cacheRead: 80, cacheWrite: 10, output: 0)
    #expect(UsageModelFormat.cacheHitRate(kinds) == 0.8)
    #expect(UsageModelFormat.cacheHitRate(.init(processed: 5, input: 0, cacheRead: 0, cacheWrite: 0, output: 5)) == nil)
    #expect(UsageModelFormat.cacheHitRate(nil) == nil)
  }

  @Test func costPerMillionNeedsAPrice() {
    let row = ArgusProtocol.UsageModelRow(model: "m", tokens: 2_000_000, costUsd: 3, priced: true)
    #expect(UsageModelFormat.costPerMillion(row) == 1.5)
    let unpriced = ArgusProtocol.UsageModelRow(model: "m", tokens: 2_000_000, costUsd: 0, priced: false, priceSource: ArgusProtocol.UsageModelRowPriceSource.none)
    #expect(UsageModelFormat.costPerMillion(unpriced) == nil)
    #expect(UsageModelFormat.isUnpriced(unpriced))
  }

  @Test func speedsShowOnlyWithAFasterTier() {
    func summary(_ speeds: [ArgusProtocol.UsageSpeedRow]) -> ArgusProtocol.ClaudeUsageSummary {
      .init(
        range: ._7d, since: 0, until: 1, bucket: .day, sessions: 1,
        tokens: .init(processed: 1, input: 1, cacheRead: 0, cacheWrite: 0, output: 0),
        cost: .init(total: 4, input: 4, cacheRead: 0, cacheWrite: 0, output: 0, premium: 1), cacheSavingsUsd: 0,
        series: [], models: [], speeds: speeds)
    }
    #expect(UsageSummaryFormat.bySpeed(summary([.init(speed: .standard, tokens: 1, costUsd: 4, premiumUsd: 0)]), metric: .cost).isEmpty)
    let rows = UsageSummaryFormat.bySpeed(
      summary([.init(speed: .standard, tokens: 1, costUsd: 3, premiumUsd: 0), .init(speed: .fast, tokens: 1, costUsd: 1, premiumUsd: 1)]),
      metric: .cost)
    #expect(rows.map(\.label) == ["Standard", "Fast"])
    #expect(rows[1].share == 0.25)
    #expect(UsageSummaryFormat.premium(summary([])) == 1)
  }
}

struct UsagePriceDraftTests {
  let prices = ArgusProtocol.UsagePrices(
    overrides: [.init(model: "custom-1", inputPerMtok: 1.5, outputPerMtok: 6), .init(model: "alias", mapTo: "claude-opus-5-5")],
    list: [
      .init(model: "claude-opus-5-5", inputPerMtok: 5, outputPerMtok: 25, cacheReadPerMtok: 0.5, cacheWritePerMtok: 6.25),
      .init(model: "custom-1", inputPerMtok: 2, outputPerMtok: 8, cacheReadPerMtok: 0.2, cacheWritePerMtok: 2.5),
    ])

  @Test func overridesComeFirstThenListModels() {
    let draft = UsagePriceDraft(prices: prices)
    #expect(draft.rows.map(\.model) == ["custom-1", "alias", "claude-opus-5-5"])
    #expect(draft["custom-1"]?.input == "1.5")
    #expect(draft["custom-1"]?.list?.input == 2)
    #expect(!draft.isDirty)
  }

  @Test func addingAModelPutsItOnTop() {
    var draft = UsagePriceDraft(prices: prices, adding: "local-llama")
    #expect(draft.rows.first?.model == "local-llama")
    let readded = draft.add("alias")
    #expect(!readded)
    #expect(draft.isDirty)
  }

  @Test func resetDropsTheOverrideUntilUndone() throws {
    var draft = UsagePriceDraft(prices: prices)
    draft.toggleReset("custom-1")
    #expect(try draft.overrides().get().map(\.model) == ["alias"])
    draft.toggleReset("custom-1")
    let saved = try draft.overrides().get()
    #expect(saved.map(\.model) == ["custom-1", "alias"])
    #expect(saved[0].cacheReadPerMtok == nil)
    #expect(saved[1].mapTo == "claude-opus-5-5")
    #expect(saved[1].inputPerMtok == nil)
  }

  @Test func aBadNumberSaysWhichField() {
    var draft = UsagePriceDraft(prices: prices)
    draft["claude-opus-5-5"]?.output = "lots"
    #expect(throws: UsagePriceDraft.DraftError.self) { try draft.overrides().get() }
  }

  @Test func pricesReadWithoutTrailingZeros() {
    #expect(UsagePriceDraft.text(3) == "3")
    #expect(UsagePriceDraft.text(0.3) == "0.3")
    #expect(UsagePriceDraft.text(nil) == "")
  }
}
