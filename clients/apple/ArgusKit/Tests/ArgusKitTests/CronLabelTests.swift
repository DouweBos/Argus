import Testing

@testable import ArgusKit

@Suite("Cron labels")
struct CronLabelTests {
  @Test(
    "common shapes read as words",
    arguments: [
      ("*/15 * * * *", "every 15 minutes"),
      ("30 * * * *", "hourly at :30"),
      ("0 */6 * * *", "every 6 hours"),
      ("0 9 * * *", "09:00 daily"),
      ("0 9 * * 1-5", "09:00 weekdays"),
      ("0 10 * * 0,6", "10:00 weekends"),
      ("0 9 * * 1", "09:00 Mondays"),
      ("0 9 * * 7", "09:00 Sundays"),
      ("30 8 * * 1,3,5", "08:30 Mon, Wed, Fri"),
      ("0 9 1 * *", "09:00 monthly on the 1st"),
      ("0 9 22 * *", "09:00 monthly on the 22nd"),
      ("0 9 13 * *", "09:00 monthly on the 13th"),
    ])
  func words(cron: String, expected: String) {
    #expect(Labels.cronLabel(cron, timezone: nil) == expected)
  }

  @Test(
    "anything fancier stays the cron",
    arguments: ["0 9 1 * 1", "0 9 * 6 *", "5 */6 * * *", "0 9 * * MON", "0 9-17 * * *", "0 9 * * 8", "bogus"])
  func fallback(cron: String) {
    #expect(Labels.cronLabel(cron, timezone: nil) == cron)
  }
}
