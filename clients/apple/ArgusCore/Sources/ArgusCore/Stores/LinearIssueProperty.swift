import ArgusKit
import Foundation
import Observation

/// Linear's property menus and hover cards: the options with their number keys,
/// how long the issue sat in each status, and who last changed a property.
public enum LinearIssueProperty {
  public typealias StatusEntry = ArgusProtocol.LinearIssueDetailStatusHistoryItem
  public typealias Event = ArgusProtocol.LinearHistoryEvent

  public enum Kind: String, Sendable {
    case status, priority, assignee, estimate, cycle, project

    var historyKind: ArgusProtocol.LinearHistoryEventKind {
      switch self {
      case .status: .status
      case .priority: .priority
      case .assignee: .assignee
      case .estimate: .estimate
      case .cycle: .cycle
      case .project: .project
      }
    }
  }

  /// One pickable value: a workflow state's id, or a priority's number.
  public struct Option: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    /// The digit that picks it while the menu is open.
    public let key: Character?

    public init(id: String, title: String, key: Character?) {
      (self.id, self.title, self.key) = (id, title, key)
    }
  }

  /// The team's workflow in order, keyed 1…9 then 0, the rest unkeyed.
  public static func statusOptions(_ states: [ArgusProtocol.LinearWorkflowState]) -> [Option] {
    states.enumerated().map { index, state in
      let key: Character? = index < 9 ? Character("\(index + 1)") : index == 9 ? "0" : nil
      return Option(id: state.id, title: state.name, key: key)
    }
  }

  /// Urgent to Low, then No priority; each keyed by Linear's own number.
  public static var priorityOptions: [Option] {
    LinearIssueBoard.priorityOrder.map {
      Option(id: "\($0)", title: LinearIssueBoard.priorityLabel($0), key: Character("\($0)"))
    }
  }

  public struct Stint: Equatable, Sendable {
    public let name: String
    public let type: String
    /// Milliseconds, summed over every time it was in that status.
    public let duration: Double
  }

  /// Statuses in the order first entered, each with its total time.
  public static func timeInStatus(_ history: [StatusEntry], now: Double = Date().timeIntervalSince1970 * 1000) -> [Stint] {
    var order: [String] = []
    var totals: [String: Stint] = [:]
    for (index, entry) in history.enumerated() {
      let end = index + 1 < history.count ? history[index + 1].enteredAt : now
      let previous = totals[entry.name]
      if previous == nil { order.append(entry.name) }
      totals[entry.name] = Stint(
        name: entry.name, type: previous?.type ?? entry.type,
        duration: (previous?.duration ?? 0) + max(0, end - entry.enteredAt))
    }
    return order.compactMap { totals[$0] }
  }

  private static let units: [(Double, String)] = [
    (365 * 86_400_000, "y"), (30 * 86_400_000, "mo"), (7 * 86_400_000, "w"),
    (86_400_000, "d"), (3_600_000, "h"), (60_000, "m"),
  ]

  /// "10mo", "5d": Linear's short durations.
  public static func shortDuration(_ ms: Double) -> String {
    for (size, unit) in units where ms >= size {
      return "\(Int(ms / size))\(unit)"
    }
    return "<1m"
  }

  /// The most recent change to that property; nil when it hasn't moved since the issue was created.
  public static func lastChange(_ kind: Kind, in history: [Event]?) -> Event? {
    (history ?? []).filter { $0.kind == kind.historyKind }.max { $0.createdAt < $1.createdAt }
  }
}

/// An open property menu: what's typed, what the keyboard is on, and what it picks.
@MainActor
@Observable
public final class LinearPropertyMenu {
  public let options: [LinearIssueProperty.Option]
  public var query = "" {
    didSet { highlighted = nil }
  }
  public var highlighted: String?

  public init(options: [LinearIssueProperty.Option]) {
    self.options = options
  }

  /// The options whose title contains what's typed.
  public var visible: [LinearIssueProperty.Option] {
    let query = query.trimmingCharacters(in: .whitespaces)
    guard !query.isEmpty else { return options }
    return options.filter { $0.title.localizedCaseInsensitiveContains(query) }
  }

  public func move(_ step: Int) {
    let rows = visible
    guard !rows.isEmpty else { return }
    guard let current = highlighted, let at = rows.firstIndex(where: { $0.id == current }) else {
      highlighted = (step > 0 ? rows.first : rows.last)?.id
      return
    }
    highlighted = rows[(at + step + rows.count) % rows.count].id
  }

  /// Return: the highlighted row, else the top match.
  public var submission: LinearIssueProperty.Option? {
    let rows = visible
    return rows.first { $0.id == highlighted } ?? rows.first
  }

  /// A digit's option, whether or not the filter shows it.
  public func option(forKey key: Character) -> LinearIssueProperty.Option? {
    options.first { $0.key == key }
  }
}
