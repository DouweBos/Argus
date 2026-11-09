import Foundation

/// The run-once trigger's clock: a local wall-clock `YYYY-MM-DDTHH:mm` in an
/// IANA zone, so "tomorrow at 9" stays 9 where you are across a DST change.
public enum OnceTime {
  private static func calendar(_ timezone: String?) -> Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timezone.flatMap(TimeZone.init(identifier:)) ?? .current
    return calendar
  }

  /// The instant `runAt` names in `timezone`, or nil when it isn't a real wall-clock time.
  public static func date(_ runAt: String, timezone: String?) -> Date? {
    let parts = runAt.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).compactMap { Int($0) }
    guard runAt.count == 16, parts.count == 5 else { return nil }
    let components = DateComponents(
      year: parts[0], month: parts[1], day: parts[2], hour: parts[3], minute: parts[4])
    let calendar = calendar(timezone)
    guard components.isValidDate(in: calendar) else { return nil }
    return calendar.date(from: components)
  }

  /// `YYYY-MM-DDTHH:mm` for an instant, as the wall clock reads it in `timezone`.
  public static func string(_ date: Date, timezone: String?) -> String {
    let c = calendar(timezone).dateComponents([.year, .month, .day, .hour, .minute], from: date)
    return String(
      format: "%04d-%02d-%02dT%02d:%02d", c.year ?? 0, c.month ?? 1, c.day ?? 1, c.hour ?? 0, c.minute ?? 0)
  }

  /// A new run-once trigger's default: the next whole hour.
  public static func nextWholeHour(after now: Date = Date(), timezone: String?) -> String {
    let hour: TimeInterval = 3600
    let next = Date(timeIntervalSince1970: (now.timeIntervalSince1970 / hour).rounded(.down) * hour + hour)
    return string(next, timezone: timezone)
  }

  /// Why a run-once time can't be saved, or nil when it can. A paused one may keep a past time.
  public static func error(_ runAt: String?, timezone: String?, enabled: Bool, now: Date = Date()) -> String? {
    guard let runAt, let date = date(runAt, timezone: timezone) else { return "Pick a date and time." }
    return enabled && date <= now ? "That time has already passed." : nil
  }
}
