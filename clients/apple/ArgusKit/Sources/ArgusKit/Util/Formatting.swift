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

  public static func metaLabel(_ status: RemoteAgentState) -> String {
    switch status {
    case .running: "running"
    case .requiresAction: "needs input"
    case .error: "blocked"
    case .stopped: "done"
    case .idle: "idle"
    }
  }

  /// When the agent last showed a sign of life; creation time until it speaks.
  public static func lastActivity(_ agent: RemoteAgentStatus) -> Double {
    agent.lastActivityAt ?? agent.createdAt ?? 0
  }

  public static func agentName(_ agent: RemoteAgentStatus) -> String {
    let title = agent.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return title.isEmpty ? "Agent \(agent.agentId.prefix(8))" : title
  }

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

    if minute.hasPrefix("*/"), hour == "*", dayOfMonth == "*", month == "*", dayOfWeek == "*" {
      let every = minute.dropFirst(2)
      return "every \(every) minutes"
    }
    guard let hourValue = Int(hour), let minuteValue = Int(minute),
      dayOfMonth == "*", month == "*"
    else { return cron }
    let time = String(format: "%02d:%02d", hourValue, minuteValue)

    switch dayOfWeek {
    case "*": return "\(time) daily"
    case "1-5": return "\(time) weekdays"
    default: return cron
    }
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
