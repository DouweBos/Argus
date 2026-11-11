import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct UsageLimitFormatTests {
  private let now = Date(timeIntervalSince1970: 1_000_000)
  private func ms(in seconds: Double) -> Double { (now.timeIntervalSince1970 + seconds) * 1000 }

  // The bar fills with what is used; a full bar means the limit is spent.
  @Test func barFillsWithTheUsedShare() {
    #expect(UsageLimitFormat.fraction(usedPercent: 0) == 0)
    #expect(UsageLimitFormat.fraction(usedPercent: 53) == 0.53)
    #expect(UsageLimitFormat.fraction(usedPercent: 120) == 1)
  }

  @Test func percentLeftRoundsDownAndClamps() {
    #expect(UsageLimitFormat.percentLeft(usedPercent: 0) == 100)
    #expect(UsageLimitFormat.percentLeft(usedPercent: 0.4) == 99)
    #expect(UsageLimitFormat.percentLeft(usedPercent: 37) == 63)
    #expect(UsageLimitFormat.percentLeft(usedPercent: 120) == 0)
    #expect(UsageLimitFormat.percentLeft(usedPercent: -5) == 100)
  }

  @Test func levelCrossesAtEightyAndNinetyFive() {
    #expect(UsageLimitFormat.level(usedPercent: 80) == .normal)
    #expect(UsageLimitFormat.level(usedPercent: 80.5) == .warning)
    #expect(UsageLimitFormat.level(usedPercent: 95) == .warning)
    #expect(UsageLimitFormat.level(usedPercent: 96) == .critical)
  }

  @Test func countdownPicksTheTwoLargestUnits() {
    #expect(UsageLimitFormat.countdown(until: ms(in: 4 * 3600 + 29 * 60 + 30), now: now) == "4h 29m")
    #expect(UsageLimitFormat.countdown(until: ms(in: 5 * 86400 + 3600 + 120), now: now) == "5d 1h")
    #expect(UsageLimitFormat.countdown(until: ms(in: 12 * 60 + 5), now: now) == "12m")
    #expect(UsageLimitFormat.countdown(until: ms(in: 20), now: now) == "<1m")
    #expect(UsageLimitFormat.countdown(until: ms(in: -1), now: now) == nil)
  }

  @Test func resetCaption() {
    #expect(UsageLimitFormat.resetCaption(resetsAtMs: ms(in: 3600), now: now) == "Resets in 1h 0m")
    #expect(UsageLimitFormat.resetCaption(resetsAtMs: ms(in: -60), now: now) == "Resetting now")
    #expect(UsageLimitFormat.resetCaption(resetsAtMs: nil, now: now) == nil)
  }

  @Test func paceCaption() {
    #expect(UsageLimitFormat.paceCaption(.ahead) == "Ahead of pace")
    #expect(UsageLimitFormat.paceCaption(.on) == "On pace")
    #expect(UsageLimitFormat.paceCaption(.under) == "Under pace")
    #expect(UsageLimitFormat.paceCaption(nil) == nil)
  }

  private func window(_ id: String) -> ArgusProtocol.UsageLimitWindow {
    .init(id: id, kind: .session, label: id, usedPercent: 10)
  }

  @Test func groupsCoverAccountsAndRunnersWithWindows() {
    let limits = ArgusProtocol.ClaudeUsageLimits(
      accounts: [.init(accountId: "a", label: "Work", status: .ok, windows: [window("s")], checkedAt: 5)],
      runners: [
        .init(runner: "codex", label: "Codex", status: .ok, plan: "pro", windows: [window("s")], checkedAt: 9),
        .init(runner: "cursor", label: "Cursor", status: .failed, windows: [], checkedAt: 7),
        .init(runner: "grok", label: "Grok", status: .unsupported, windows: [], checkedAt: 3),
      ])
    #expect(UsageLimitFormat.groups(limits).map(\.label) == ["Claude", "Codex"])
    #expect(UsageLimitFormat.checkedAt(limits) == 9)
    #expect(UsageLimitFormat.groups(nil).isEmpty)
  }

  @Test func severalAccountsGoByTheirNames() {
    let limits = ArgusProtocol.ClaudeUsageLimits(accounts: [
      .init(accountId: "a", label: "Work", status: .ok, windows: [window("s")], checkedAt: 1),
      .init(accountId: "b", label: "Personal", status: .ok, windows: [window("s")], checkedAt: 1),
    ])
    #expect(UsageLimitFormat.groups(limits).map(\.label) == ["Work", "Personal"])
  }
}
