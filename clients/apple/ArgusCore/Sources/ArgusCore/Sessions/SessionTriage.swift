import Foundation

/// Where a session sorts: what needs you first, then what's running, then the
/// rest; done and snoozed ones fold away. The Mac sidebar and the phone share it.
public enum SessionAttention: Int, Comparable, Sendable, CaseIterable {
  case needsYou, working, idle, done, snoozed

  public static func < (a: Self, b: Self) -> Bool { a.rawValue < b.rawValue }

  public var title: String {
    switch self {
    case .needsYou: "Needs you"
    case .working: "Working"
    case .idle: "Idle"
    case .done: "Done"
    case .snoozed: "Snoozed"
    }
  }
}

extension RemoteSession {
  /// Snoozed until a time still to come.
  public func isSnoozed(now: Date = .now) -> Bool {
    snoozedUntil.map { $0 > now.timeIntervalSince1970 * 1000 } ?? false
  }

  public var snoozedUntilDate: Date? { snoozedUntil.map { Date(timeIntervalSince1970: $0 / 1000) } }

  /// Marked done, or its pull request merged or closed and not kept active.
  public var isDone: Bool {
    if let settled { return settled }
    guard let state = pullRequest?.state else { return false }
    return state == .merged || state == .closed
  }
}

extension SessionActivity {
  /// Blocked on a permission, a question or a plan, a turn finished unread, or setup failed.
  public var needsYou: Bool {
    guard !session.isUnavailable else { return false }
    return session.status == .error || session.unread == true
      || agents.contains { $0.awaiting != nil || $0.status == .requiresAction }
  }

  /// A needs-you session shows whatever it's snoozed or done as: something is waiting on it.
  public func attention(now: Date = .now) -> SessionAttention {
    if needsYou { return .needsYou }
    if session.isSnoozed(now: now) { return .snoozed }
    if isBusy || (session.pullRequestWatched == true && session.pullRequest?.isOpen == true) { return .working }
    return session.isDone ? .done : .idle
  }
}

/// A list of sessions split by attention, each keeping the order it came in.
public struct SessionTriage: Sendable {
  public var needsYou: [RemoteSession] = []
  /// Working first, then idle.
  public var active: [RemoteSession] = []
  public var done: [RemoteSession] = []
  public var snoozed: [RemoteSession] = []

  public init(
    _ sessions: [RemoteSession], now: Date = .now, agents: (RemoteSession) -> [RemoteAgentStatus]
  ) {
    var working: [RemoteSession] = []
    var idle: [RemoteSession] = []
    for session in sessions {
      switch SessionActivity(session: session, agents: agents(session)).attention(now: now) {
      case .needsYou: needsYou.append(session)
      case .working: working.append(session)
      case .idle: idle.append(session)
      case .done: done.append(session)
      case .snoozed: snoozed.append(session)
      }
    }
    active = working + idle
  }

  /// Everything folded away.
  public var folded: [RemoteSession] { done + snoozed }
}

/// The ready-made times a session can be snoozed until.
public enum SnoozePreset: String, CaseIterable, Sendable {
  case oneHour, thisEvening, tomorrow, nextWeek

  public var title: String {
    switch self {
    case .oneHour: "For 1 Hour"
    case .thisEvening: "Until This Evening"
    case .tomorrow: "Until Tomorrow Morning"
    case .nextWeek: "Until Next Week"
    }
  }

  /// When it ends, or nil when it makes no sense now (this evening, once evening has come).
  public func date(from now: Date = .now, calendar: Calendar = .current) -> Date? {
    switch self {
    case .oneHour:
      return now.addingTimeInterval(3600)
    case .thisEvening:
      let evening = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: now)
      return evening.flatMap { $0 > now.addingTimeInterval(1800) ? $0 : nil }
    case .tomorrow:
      return calendar.date(byAdding: .day, value: 1, to: now)
        .flatMap { calendar.date(bySettingHour: 9, minute: 0, second: 0, of: $0) }
    case .nextWeek:
      let monday = calendar.nextDate(
        after: now, matching: DateComponents(hour: 9, minute: 0, weekday: 2), matchingPolicy: .nextTime)
      return monday
    }
  }
}

/// The phone's session groups split the same way. The project root and sessions
/// known only from their agents stay active; the root never folds away.
public struct SessionGroupTriage: Sendable {
  public var needsYou: [SessionGroup] = []
  public var active: [SessionGroup] = []
  public var done: [SessionGroup] = []
  public var snoozed: [SessionGroup] = []

  public init(_ groups: [SessionGroup], now: Date = .now) {
    var working: [SessionGroup] = []
    var idle: [SessionGroup] = []
    for group in groups {
      guard let session = group.session else {
        idle.append(group)
        continue
      }
      let attention = SessionActivity(session: session, agents: group.agents).attention(now: now)
      switch attention {
      case .needsYou: needsYou.append(group)
      case .working: working.append(group)
      case .done where !group.isRoot: done.append(group)
      case .snoozed where !group.isRoot: snoozed.append(group)
      default: idle.append(group)
      }
    }
    // The root keeps its place at the top.
    let roots = (working + idle).filter(\.isRoot)
    active = roots + working.filter { !$0.isRoot } + idle.filter { !$0.isRoot }
  }

  public var folded: [SessionGroup] { done + snoozed }

  /// "2 done · 1 snoozed".
  public var foldedLabel: String {
    [done.isEmpty ? nil : "\(done.count) done", snoozed.isEmpty ? nil : "\(snoozed.count) snoozed"]
      .compactMap { $0 }.joined(separator: " · ")
  }
}
