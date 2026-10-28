import ArgusKit
import Foundation

/// A Linear-style filter on the issues Argus already fetched: a field, "is"
/// or "is not", and the values it matches. Same values, labels and order as
/// the desktop's `app/lib/issueFilters.ts`, so both persist the same thing.
public struct IssueFilter: Codable, Hashable, Sendable {
  public var field: Field
  /// "is not" / "doesn't contain".
  public var negate: Bool
  /// Option values; for `content`, the text to look for.
  public var values: [String]

  public init(field: Field, negate: Bool = false, values: [String]) {
    self.field = field
    self.negate = negate
    self.values = values
  }

  public enum Field: String, Codable, CaseIterable, Identifiable, Sendable {
    case team, status, statusType, assignee, creator, priority, estimate, labels, relations
    case due, created, updated, project, cycle, links, content

    public var id: String { rawValue }

    public var label: String {
      switch self {
      case .team: "Team"
      case .status: "Status"
      case .statusType: "Status type"
      case .assignee: "Assignee"
      case .creator: "Creator"
      case .priority: "Priority"
      case .estimate: "Estimate"
      case .labels: "Labels"
      case .relations: "Relations"
      case .due: "Due date"
      case .created: "Created"
      case .updated: "Updated"
      case .project: "Project"
      case .cycle: "Cycle"
      case .links: "Links"
      case .content: "Content"
      }
    }

    /// Takes free text instead of picking from options.
    public var isText: Bool { self == .content }
  }

  public struct Option: Hashable, Identifiable, Sendable {
    public let value: String
    public let label: String
    public let count: Int
    public var id: String { value }
  }
}

public enum IssueFilters {
  public typealias Issue = ArgusProtocol.LinearIssue
  public typealias Field = IssueFilter.Field

  /// The value for "no assignee", "no labels" and so on.
  public static let none = "__none__"

  /// The current-cycle filter the old Current cycle toggle became.
  public static let currentCycle = IssueFilter(field: .cycle, values: ["current"])

  /// Fields in the order the Filter menu lists them, grouped like Linear's.
  public static let groups: [[Field]] = [
    [
      .team, .status, .statusType, .assignee, .creator, .priority, .estimate, .labels, .relations, .due,
      .created, .updated,
    ],
    [.project, .cycle],
    [.links, .content],
  ]

  private static let day: Double = 24 * 60 * 60 * 1000

  private static let statusTypeNames = [
    "triage": "Triage", "backlog": "Backlog", "unstarted": "Unstarted", "started": "Started",
    "completed": "Completed", "canceled": "Canceled", "duplicate": "Duplicate",
  ]

  private static let recency: [(value: String, label: String)] = [
    ("1d", "In the last day"), ("7d", "In the last week"),
    ("30d", "In the last month"), ("90d", "In the last 3 months"),
  ]

  /// Options offered before (or instead of) the ones seen in the data.
  private static func fixed(_ field: Field) -> [(value: String, label: String)] {
    switch field {
    case .priority: LinearIssueBoard.priorityOrder.map { (String($0), LinearIssueBoard.priorityLabel($0)) }
    case .relations: [("sub", "Is a sub-issue"), ("top", "Isn't a sub-issue")]
    case .created, .updated: recency
    case .due: [("overdue", "Overdue"), ("week", "Due in the next week"), ("later", "Due later")]
    case .cycle: [("current", "Current cycle")]
    case .links: [("pr", "Has a pull request"), ("no-pr", "No pull request")]
    default: []
    }
  }

  /// Only the fixed options: the data adds none.
  private static func fixedOnly(_ field: Field) -> Bool {
    [.priority, .relations, .created, .updated, .links].contains(field)
  }

  private static func labelOf(_ field: Field, _ value: String) -> String? {
    switch field {
    case .statusType: statusTypeNames[value] ?? value
    case .estimate: "\(value) pt"
    default: nil
    }
  }

  /// JavaScript's `String(n)`: no trailing ".0".
  private static func number(_ value: Double) -> String {
    value.rounded() == value && abs(value) < 1e15 ? String(Int(value)) : String(value)
  }

  private static func recency(_ epochMs: Double, now: Double) -> [String] {
    let age = now - epochMs
    return zip([1.0, 7, 30, 90], ["1d", "7d", "30d", "90d"]).compactMap { age <= $0 * day ? $1 : nil }
  }

  private static let dueFormat: DateFormatter = {
    let format = DateFormatter()
    format.locale = Locale(identifier: "en_US_POSIX")
    format.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    return format
  }()

  private static func dueBuckets(_ due: String?, now: Double) -> [String] {
    guard let due, !due.isEmpty else { return [none] }
    guard let date = dueFormat.date(from: "\(due)T23:59:59") else { return ["later"] }
    let at = date.timeIntervalSince1970 * 1000
    if at < now { return ["overdue"] }
    return at - now <= 7 * day ? ["week"] : ["later"]
  }

  /// An issue's values for a field; plural fields match when any is picked.
  static func values(_ field: Field, of issue: Issue, now: Double) -> [String] {
    switch field {
    case .team: [issue.teamName]
    case .status: [issue.state.name]
    case .statusType: [issue.state.type]
    case .assignee: [issue.assignee ?? none]
    case .creator: [issue.creator ?? none]
    case .priority: [number(issue.priority)]
    case .estimate: [issue.estimate.map(number) ?? none]
    case .labels: issue.labels.isEmpty ? [none] : issue.labels
    case .relations: [issue.parent == nil ? "top" : "sub"]
    case .created: recency(issue.createdAt, now: now)
    case .updated: recency(issue.updatedAt, now: now)
    case .due: dueBuckets(issue.dueDate, now: now)
    case .project: [issue.project?.name ?? none]
    case .cycle: (issue.cycle?.isActive == true ? ["current"] : []) + [LinearIssueBoard.cycleLabel(issue) ?? none]
    case .links: [issue.pullRequestCount > 0 ? "pr" : "no-pr"]
    case .content: []
    }
  }

  /// The options a field offers for these issues, with how many match each.
  public static func options(_ field: Field, issues: [Issue], now: Date = Date()) -> [IssueFilter.Option] {
    let ms = now.timeIntervalSince1970 * 1000
    var counts: [String: Int] = [:]
    for issue in issues {
      for value in Set(values(field, of: issue, now: ms)) { counts[value, default: 0] += 1 }
    }
    let fixed = fixed(field)
    let fixedValues = Set(fixed.map(\.value))
    let seen: [(value: String, label: String)] =
      fixedOnly(field)
      ? []
      : counts.keys.filter { $0 != none && !fixedValues.contains($0) }
        .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        .map { ($0, labelOf(field, $0) ?? $0) }
    let empty: [(value: String, label: String)] =
      !fixedOnly(field) && counts[none] != nil ? [(none, noneLabel(field))] : []
    return (fixed + seen + empty).map { .init(value: $0.value, label: $0.label, count: counts[$0.value] ?? 0) }
  }

  public static func optionLabel(_ field: Field, _ value: String) -> String {
    if value == none { return noneLabel(field) }
    return fixed(field).first { $0.value == value }?.label ?? labelOf(field, value) ?? value
  }

  private static func noneLabel(_ field: Field) -> String {
    "No \(field.label.lowercased())"
  }

  static func matches(_ issue: Issue, _ filter: IssueFilter, now: Double) -> Bool {
    guard !filter.values.isEmpty else { return true }
    let hit: Bool
    if filter.field == .content {
      let haystack = "\(issue.identifier) \(issue.title) \(issue.description)".lowercased()
      hit = filter.values.allSatisfy { haystack.contains($0.lowercased()) }
    } else {
      let values = values(filter.field, of: issue, now: now)
      hit = filter.values.contains(where: values.contains)
    }
    return filter.negate ? !hit : hit
  }

  /// Issues every filter matches.
  public static func apply(_ issues: [Issue], _ filters: [IssueFilter], now: Date = Date()) -> [Issue] {
    guard !filters.isEmpty else { return issues }
    let ms = now.timeIntervalSince1970 * 1000
    return issues.filter { issue in filters.allSatisfy { matches(issue, $0, now: ms) } }
  }

  // MARK: - The filter row

  /// "is" / "is not", or "contains" / "doesn't contain" for text.
  public static func operatorLabel(_ filter: IssueFilter) -> String {
    if filter.field.isText { return filter.negate ? "doesn't contain" : "contains" }
    return filter.negate ? "is not" : "is"
  }

  /// The chip's values: up to two by name, then a count.
  public static func summary(_ filter: IssueFilter) -> String {
    if filter.field.isText { return filter.values.joined(separator: " ") }
    let labels = filter.values.map { optionLabel(filter.field, $0) }
    return labels.count > 2 ? "\(labels.count) \(filter.field.label.lowercased())" : labels.joined(separator: ", ")
  }

  /// `filters` with one field's filter changed; a filter left with no values
  /// goes. A changed filter keeps its place in the row, a new one goes last.
  public static func updating(
    _ filters: [IssueFilter], _ field: Field, _ change: (IssueFilter) -> IssueFilter?
  ) -> [IssueFilter] {
    let current = filters.first { $0.field == field } ?? IssueFilter(field: field, values: [])
    let rest = filters.filter { $0.field != field }
    guard let next = change(current), !next.values.isEmpty else { return rest }
    return filters.contains { $0.field == field } ? filters.map { $0.field == field ? next : $0 } : rest + [next]
  }

  /// Ticks or unticks one option.
  public static func toggling(_ filters: [IssueFilter], _ field: Field, _ value: String) -> [IssueFilter] {
    updating(filters, field) { filter in
      var filter = filter
      if let index = filter.values.firstIndex(of: value) {
        filter.values.remove(at: index)
      } else {
        filter.values.append(value)
      }
      return filter
    }
  }
}
