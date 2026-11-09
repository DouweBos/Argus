import ArgusKit
import Foundation

/// The host's 5-field cron evaluator (`services/automation/cron.ts`), ported so
/// the editors can validate and preview a schedule before saving it. The host
/// stays the authority on when a run actually fires.
public struct CronSchedule: Sendable, Equatable {
  public let minute: Set<Int>
  public let hour: Set<Int>
  public let dayOfMonth: Set<Int>
  public let month: Set<Int>
  public let dayOfWeek: Set<Int>
  /// Vixie semantics: when both day fields are restricted, either may match.
  let domRestricted: Bool
  let dowRestricted: Bool

  public struct ParseError: Error, Equatable, CustomStringConvertible {
    public let description: String
  }

  private static let ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 7)]

  public init(_ expression: String) throws {
    let parts = expression.split(whereSeparator: \.isWhitespace).map(String.init)
    guard parts.count == 5 else {
      throw ParseError(description: "cron expression must have 5 fields (min hour dom mon dow), got \(parts.count)")
    }
    var dow = try Self.field(parts[4], 4)
    // 7 and 0 both mean Sunday.
    if dow.remove(7) != nil { dow.insert(0) }
    minute = try Self.field(parts[0], 0)
    hour = try Self.field(parts[1], 1)
    dayOfMonth = try Self.field(parts[2], 2)
    month = try Self.field(parts[3], 3)
    dayOfWeek = dow
    domRestricted = parts[2] != "*"
    dowRestricted = parts[4] != "*"
  }

  private static func field(_ spec: String, _ index: Int) throws -> Set<Int> {
    let (min, max) = ranges[index]
    var out = Set<Int>()
    for part in spec.split(separator: ",", omittingEmptySubsequences: false) {
      let trimmed = part.trimmingCharacters(in: .whitespaces)
      guard !trimmed.isEmpty else { throw ParseError(description: "empty cron field element in \"\(spec)\"") }
      let pieces = trimmed.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
      var step = 1
      if pieces.count > 1 {
        guard pieces.count == 2, let s = Int(pieces[1]), s > 0 else {
          throw ParseError(description: "invalid cron step \"\(trimmed)\"")
        }
        step = s
      }
      let range = pieces[0]
      let lo: Int?
      let hi: Int?
      if range == "*" {
        (lo, hi) = (min, max)
      } else if range.contains("-") {
        let bounds = range.split(separator: "-", omittingEmptySubsequences: false)
        (lo, hi) = bounds.count == 2 ? (Int(bounds[0]), Int(bounds[1])) : (nil, nil)
      } else {
        lo = Int(range)
        hi = pieces.count > 1 ? max : lo
      }
      guard let lo, let hi, lo <= hi else { throw ParseError(description: "invalid cron range \"\(trimmed)\"") }
      guard lo >= min, hi <= max else { throw ParseError(description: "cron value out of range in \"\(trimmed)\"") }
      out.formUnion(stride(from: lo, through: hi, by: step))
    }
    return out
  }

  /// The next `count` instants strictly after `from`, stopping early when the
  /// expression can't match within four years (e.g. `0 0 30 2 *`).
  public func nextRuns(after from: Date, in timeZone: TimeZone, count: Int) -> [Date] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    var out: [Date] = []
    var cursor = from
    while out.count < count, let next = nextRun(after: cursor, calendar: calendar) {
      out.append(next)
      cursor = next
    }
    return out
  }

  /// Walks local calendar space like the host does, so a wall-clock schedule
  /// keeps its time across a DST shift.
  private func nextRun(after from: Date, calendar: Calendar) -> Date? {
    let start = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: from.addingTimeInterval(60))
    guard var y = start.year, var mo = start.month, var d = start.day, var h = start.hour, var mi = start.minute
    else { return nil }
    let limitYear = y + 4

    var utc = Calendar(identifier: .gregorian)
    utc.timeZone = TimeZone(identifier: "UTC")!
    func daysIn(_ year: Int, _ month: Int) -> Int {
      utc.range(of: .day, in: .month, for: utc.date(from: DateComponents(year: year, month: month))!)!.count
    }
    func nextDay() {
      (h, mi) = (0, 0)
      if d < daysIn(y, mo) { d += 1 } else { nextMonth() }
    }
    func nextMonth() {
      (d, h, mi) = (1, 0, 0)
      if mo == 12 { (y, mo) = (y + 1, 1) } else { mo += 1 }
    }

    for _ in 0..<500_000 {
      if y > limitYear { return nil }
      if !month.contains(mo) { nextMonth(); continue }
      let weekday = utc.component(.weekday, from: utc.date(from: DateComponents(year: y, month: mo, day: d))!) - 1
      let dom = dayOfMonth.contains(d)
      let dow = dayOfWeek.contains(weekday)
      if !(domRestricted && dowRestricted ? dom || dow : dom && dow) { nextDay(); continue }
      if !hour.contains(h) {
        if h < 23 { (h, mi) = (h + 1, 0) } else { nextDay() }
        continue
      }
      if !minute.contains(mi) {
        if mi < 59 { mi += 1 } else if h < 23 { (h, mi) = (h + 1, 0) } else { nextDay() }
        continue
      }
      let wallClock = utc.date(from: DateComponents(year: y, month: mo, day: d, hour: h, minute: mi))!
      let instant = Self.instant(of: wallClock, in: calendar.timeZone)
      if instant > from { return instant }
      if mi < 59 { mi += 1 } else if h < 23 { (h, mi) = (h + 1, 0) } else { nextDay() }
    }
    return nil
  }

  /// The host's two-pass zone conversion: a time in the spring-forward gap
  /// lands where the clock jumps to, a repeated fall-back time on its
  /// standard-time occurrence, so the preview fires once, as the host does.
  private static func instant(of wallClock: Date, in zone: TimeZone) -> Date {
    let first = wallClock.addingTimeInterval(-Double(zone.secondsFromGMT(for: wallClock)))
    return wallClock.addingTimeInterval(-Double(zone.secondsFromGMT(for: first)))
  }

  /// The editor's verdict on a schedule: why it's rejected, or its next runs.
  /// Wording matches the desktop editor's.
  public static func preview(
    cron: String, timezone: String, count: Int = 5, from: Date = Date()
  ) -> Result<[Date], ParseError> {
    let zoneId = timezone.trimmingCharacters(in: .whitespaces)
    guard let zone = zoneId.isEmpty ? TimeZone.current : TimeZone(identifier: zoneId) else {
      return .failure(ParseError(description: "Unknown timezone — use an IANA name like Europe/Amsterdam."))
    }
    guard let schedule = try? CronSchedule(cron) else {
      return .failure(ParseError(description: "Five fields: min hour dom mon dow."))
    }
    let runs = schedule.nextRuns(after: from, in: zone, count: count)
    if runs.isEmpty {
      return .failure(ParseError(description: "Valid, but never fires within the next four years."))
    }
    return .success(runs)
  }
}

public struct SchedulePreviewText: Equatable, Sendable {
  public let headline: String?
  public let runs: [String]
  public let error: String?
}

extension RemoteAutomationDetail {
  /// Nil for a manual trigger; otherwise the schedule's next runs or why it's rejected.
  public func schedulePreview(count: Int = 5, from: Date = Date()) -> Result<[Date], CronSchedule.ParseError>? {
    guard triggerKind == .schedule else { return nil }
    return CronSchedule.preview(cron: cron ?? "", timezone: timezone ?? "", count: count, from: from)
  }

  /// The preview as text both editors render: the cron in words where it's a
  /// common shape, and the next runs in the schedule's own zone.
  public func schedulePreviewText(from: Date = Date()) -> SchedulePreviewText? {
    switch schedulePreview(from: from) {
    case nil: return nil
    case .failure(let error)?: return SchedulePreviewText(headline: nil, runs: [], error: error.description)
    case .success(let dates)?:
      let words = Labels.cronLabel(cron ?? "", timezone: timezone)
      var style = Date.FormatStyle(date: .abbreviated, time: .shortened).weekday(.abbreviated)
      if let zone = timezone.flatMap(TimeZone.init(identifier:)) { style.timeZone = zone }
      return SchedulePreviewText(
        headline: words == cron ? nil : words.prefix(1).uppercased() + words.dropFirst(),
        runs: dates.map { $0.formatted(style) }, error: nil)
    }
  }

  /// Why a run-once trigger can't be saved; nil for other kinds or a good time.
  public var onceError: String? {
    guard triggerKind == .once else { return nil }
    return OnceTime.error(runAt, timezone: timezone, enabled: enabled)
  }

  /// Whether the trigger can be saved: manual, a schedule that fires, or a run-once time.
  public var hasValidTrigger: Bool {
    if case .failure = schedulePreview(count: 1) { return false }
    return onceError == nil
  }
}
