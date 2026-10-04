import Foundation
import Testing

@testable import ArgusCore

/// Mirrors the host's `cron.test.ts`, so the preview and the scheduler agree.
struct CronScheduleTests {
  private let utc = TimeZone(identifier: "UTC")!
  private let ams = TimeZone(identifier: "Europe/Amsterdam")!

  private func at(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

  private func next(_ cron: String, _ zone: TimeZone, _ from: String) throws -> Date? {
    try CronSchedule(cron).nextRuns(after: at(from), in: zone, count: 1).first
  }

  @Test func parsesTheFiveFieldGrammar() throws {
    let schedule = try CronSchedule("*/15 0-4 1,15 * 1-5")
    #expect(schedule.minute == [0, 15, 30, 45])
    #expect(schedule.hour == [0, 1, 2, 3, 4])
    #expect(schedule.dayOfMonth == [1, 15])
    #expect(schedule.dayOfWeek == [1, 2, 3, 4, 5])
    #expect(try CronSchedule("0 0 * * 7").dayOfWeek == [0])
  }

  @Test(arguments: ["0 0 * *", "60 0 * * *", "0 0 * 13 *", "0 5-1 * * *", "*/0 * * * *", "every minute please"])
  func rejects(_ expression: String) {
    #expect(throws: CronSchedule.ParseError.self) { try CronSchedule(expression) }
  }

  @Test func findsTheNextRun() throws {
    #expect(try next("* * * * *", utc, "2026-03-01T10:00:30Z") == at("2026-03-01T10:01:00Z"))
    #expect(try next("*/15 * * * *", utc, "2026-03-01T10:46:00Z") == at("2026-03-01T11:00:00Z"))
    #expect(try next("0 */6 * * *", utc, "2026-03-01T07:00:00Z") == at("2026-03-01T12:00:00Z"))
    #expect(try next("30 7 * * 1-5", utc, "2026-03-06T08:00:00Z") == at("2026-03-09T07:30:00Z"))
    #expect(try next("0 0 1 1 *", utc, "2026-06-01T00:00:00Z") == at("2027-01-01T00:00:00Z"))
    #expect(try next("30 7 * * *", ams, "2026-01-10T12:00:00Z") == at("2026-01-11T06:30:00Z"))
  }

  @Test func keepsWallClockTimeAcrossDST() throws {
    #expect(try next("30 7 * * *", ams, "2026-03-28T06:30:00Z") == at("2026-03-29T05:30:00Z"))
    #expect(try next("30 2 * * *", ams, "2026-03-28T01:30:00Z") == at("2026-03-29T01:30:00Z"))
    #expect(try next("30 7 * * *", ams, "2026-10-24T05:30:00Z") == at("2026-10-25T06:30:00Z"))
    let runs = try CronSchedule("30 2 * * *").nextRuns(after: at("2026-10-24T12:00:00Z"), in: ams, count: 2)
    #expect(runs == [at("2026-10-25T01:30:00Z"), at("2026-10-26T01:30:00Z")])
  }

  @Test func previewExplainsWhatIsWrong() throws {
    let from = at("2026-01-01T00:00:00Z")
    #expect(try CronSchedule.preview(cron: "0 9 * * 1-5", timezone: "UTC", from: from).get().count == 5)
    #expect(CronSchedule.preview(cron: "0 0 30 2 *", timezone: "UTC", from: from).failureText?.contains("never fires") == true)
    #expect(CronSchedule.preview(cron: "nope", timezone: "UTC", from: from).failureText?.contains("Five fields") == true)
    #expect(CronSchedule.preview(cron: "* * * * *", timezone: "Mars/Olympus", from: from).failureText?.contains("timezone") == true)
  }
}

extension Result where Failure == CronSchedule.ParseError {
  fileprivate var failureText: String? {
    if case .failure(let error) = self { return error.description }
    return nil
  }
}

struct SchedulePreviewTextTests {
  @Test func describesCommonShapesAndRejectsBadZones() throws {
    var draft = RemoteAutomationDetail(extraInstructions: "")
    draft.triggerKind = .schedule
    draft.cron = "0 9 * * 1-5"
    draft.timezone = "UTC"
    let preview = try #require(draft.schedulePreviewText())
    #expect(preview.headline == "09:00 weekdays")
    #expect(preview.runs.count == 5)
    #expect(draft.hasValidTrigger)
    draft.timezone = "Nowhere/Land"
    #expect(draft.schedulePreviewText()?.error != nil)
    #expect(!draft.hasValidTrigger)
    draft.triggerKind = .manual
    #expect(draft.schedulePreviewText() == nil)
    #expect(draft.hasValidTrigger)
  }
}
