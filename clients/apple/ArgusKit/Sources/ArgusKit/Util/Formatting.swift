import Foundation

/// Labels and sort weights shared by every list, ported from `rows.tsx`,
/// `runRows.tsx` and `automations.ts`.
public enum Labels {

  // MARK: Agents

  /// Sort weight: anything that wants you outranks anything merely recent.
  public static func activityRank(_ agent: RemoteAgentStatus) -> Int {
    if agent.awaiting != nil || agent.status == .requiresAction { return 0 }
    switch agent.status {
    case .running: return 1
    case .error: return 2
    case .idle: return 3
    case .stopped: return 4
    case .requiresAction: return 0
    }
  }

  /// What the agent is blocked on, phrased as a badge.
  public static func awaitingLabel(_ agent: RemoteAgentStatus) -> String? {
    switch agent.awaiting {
    case .permission: "needs approval"
    case .question: "answer needed"
    case .plan: "review plan"
    case nil: nil
    }
  }

  /// One word for an agent's state, the same on every screen.
  public static func statusLabel(_ status: RemoteAgentState) -> String {
    switch status {
    case .running: "running"
    case .requiresAction: "needs input"
    case .error: "error"
    case .stopped: "stopped"
    case .idle: "idle"
    }
  }

  /// When the agent last showed a sign of life; creation time until it speaks.
  public static func lastActivity(_ agent: RemoteAgentStatus) -> Double {
    agent.lastActivityAt ?? agent.createdAt ?? 0
  }

  /// Its title; "New agent" until the computer names it from the first turn.
  public static func agentName(_ agent: RemoteAgentStatus) -> String {
    let title = agent.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return title.isEmpty ? untitledAgent : title
  }

  /// Its title among the tabs it sits with: untitled siblings number by start
  /// time ("New agent", "New agent 2"), so no two tabs read the same.
  public static func agentName(_ agent: RemoteAgentStatus, among siblings: [RemoteAgentStatus]) -> String {
    let name = agentName(agent)
    guard name == untitledAgent else { return name }
    let untitled = siblings.filter { agentName($0) == untitledAgent && $0.sessionId == agent.sessionId }
      .sorted { ($0.createdAt ?? 0, $0.agentId) < ($1.createdAt ?? 0, $1.agentId) }
    guard let rank = untitled.firstIndex(where: { $0.agentId == agent.agentId }), rank > 0 else { return name }
    return "\(untitledAgent) \(rank + 1)"
  }

  public static let untitledAgent = "New agent"

  /// The pending auto-continue after a usage limit, phrased as a banner.
  public static func limitResumeBanner(_ millis: Double, now: Date = Date()) -> String {
    let when = Date(timeIntervalSince1970: millis / 1000)
    let time = when.formatted(date: .omitted, time: .shortened)
    let day =
      Calendar.current.isDate(when, inSameDayAs: now)
      ? "" : "\(when.formatted(.dateTime.weekday(.abbreviated))) "
    return "Usage limit reached. Continues automatically \(day)at \(time)."
  }

  // MARK: Time

  /// Unix milliseconds to a short relative phrase.
  public static func timeAgo(_ millis: Double, now: Date = Date()) -> String {
    let seconds = now.timeIntervalSince1970 - millis / 1000
    if seconds < 60 { return "just now" }
    let minutes = Int(seconds / 60)
    if minutes < 60 { return "\(minutes)m ago" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h ago" }
    let days = hours / 24
    return days == 1 ? "yesterday" : "\(days)d ago"
  }

  /// How long until a scheduled run fires.
  public static func until(_ millis: Double?, now: Date = Date()) -> String? {
    guard let millis else { return nil }
    let seconds = millis / 1000 - now.timeIntervalSince1970
    if seconds <= 0 { return "now" }
    let minutes = Int(seconds / 60)
    if minutes < 60 { return "in \(max(1, minutes))m" }
    let hours = minutes / 60
    if hours < 48 { return "in \(hours)h" }
    return "in \(hours / 24)d"
  }

  // MARK: Automations

  /// Render the common cron shapes in words, and fall back to the expression
  /// itself for anything fancier — a wrong plain-English reading of a cron is
  /// worse than the cron.
  public static func cronLabel(_ cron: String, timezone: String?) -> String {
    let parts = cron.split(separator: " ").map(String.init)
    guard parts.count == 5 else { return cron }
    let (minute, hour, dayOfMonth, month, dayOfWeek) =
      (parts[0], parts[1], parts[2], parts[3], parts[4])

    let everyDay = dayOfMonth == "*" && month == "*" && dayOfWeek == "*"
    if minute.hasPrefix("*/"), Int(minute.dropFirst(2)) != nil, hour == "*", everyDay {
      return "every \(minute.dropFirst(2)) minutes"
    }
    guard let minuteValue = Int(minute), (0..<60).contains(minuteValue), month == "*" else { return cron }
    if everyDay {
      if hour == "*" { return "hourly at :\(String(format: "%02d", minuteValue))" }
      if hour.hasPrefix("*/"), let step = Int(hour.dropFirst(2)), minuteValue == 0 { return "every \(step) hours" }
    }
    guard let hourValue = Int(hour), (0..<24).contains(hourValue) else { return cron }
    let time = String(format: "%02d:%02d", hourValue, minuteValue)

    if dayOfWeek == "*" {
      if dayOfMonth == "*" { return "\(time) daily" }
      guard let day = Int(dayOfMonth), (1...31).contains(day) else { return cron }
      return "\(time) monthly on the \(ordinal(day))"
    }
    guard dayOfMonth == "*" else { return cron }
    switch dayOfWeek {
    case "1-5": return "\(time) weekdays"
    case "0,6", "6,0", "6-7": return "\(time) weekends"
    default:
      let days = dayOfWeek.split(separator: ",").map { Int($0) }
      guard !days.isEmpty, days.allSatisfy({ $0.map((0...7).contains) == true }) else { return cron }
      let names = days.compactMap { $0 }.map { weekdayNames[$0 % 7] }
      return names.count == 1 ? "\(time) \(names[0])s" : "\(time) \(names.map { $0.prefix(3) }.joined(separator: ", "))"
    }
  }

  private static let weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

  private static func ordinal(_ day: Int) -> String {
    let suffix =
      switch day {
      case 11, 12, 13: "th"
      default: ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][day % 10]
      }
    return "\(day)\(suffix)"
  }

  public static func triggerLabel(_ automation: RemoteAutomation) -> String {
    switch automation.triggerKind {
    case .manual: "Manual"
    case .schedule:
      automation.cron.map { cronLabel($0, timezone: automation.timezone) } ?? "Scheduled"
    }
  }

  /// Counts up while a run is in flight, so it reads as live.
  public static func runDuration(_ run: RemoteAutomationRun, now: Date = Date()) -> String {
    let end = run.finishedAt ?? now.timeIntervalSince1970 * 1000
    let seconds = max(0, Int((end - run.startedAt) / 1000))
    if seconds < 60 { return "\(seconds)s" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m \(seconds % 60)s" }
    return "\(minutes / 60)h \(minutes % 60)m"
  }

  public static func runCost(_ run: RemoteAutomationRun) -> String {
    guard let cost = run.costUsd else { return "—" }
    return String(format: "$%.2f", cost)
  }
}
