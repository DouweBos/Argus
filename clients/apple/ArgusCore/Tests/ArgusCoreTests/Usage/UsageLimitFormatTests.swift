import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct UsageLimitFormatTests {
  private let now = Date(timeIntervalSince1970: 1_000_000)
  private func ms(in seconds: Double) -> Double { (now.timeIntervalSince1970 + seconds) * 1000 }

  @Test func percentLeftRoundsDownAndClamps() {
    #expect(UsageLimitFormat.percentLeft(usedPercent: 0) == 100)
    #expect(UsageLimitFormat.percentLeft(usedPercent: 0.4) == 99)
    #expect(UsageLimitFormat.percentLeft(usedPercent: 37) == 63)
    #expect(UsageLimitFormat.percentLeft(usedPercent: 120) == 0)
    #expect(UsageLimitFormat.percentLeft(usedPercent: -5) == 100)
  }

  @Test func fractionLeftMatchesPercentLeft() {
    #expect(UsageLimitFormat.fractionLeft(usedPercent: 25) == 0.75)
    #expect(UsageLimitFormat.fractionLeft(usedPercent: 0) == 1)
    #expect(UsageLimitFormat.fractionLeft(usedPercent: 120) == 0)
    #expect(UsageLimitFormat.fractionLeft(usedPercent: -5) == 1)
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
}
