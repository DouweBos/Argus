import ArgusKit
import Foundation

extension ArgusProtocol.LinearIssue: @retroactive Identifiable {}
extension ArgusProtocol.LinearIssueDetail: @retroactive Identifiable {}
extension ArgusProtocol.LinearWorkflowState: @retroactive Identifiable {}

extension ArgusProtocol.LinearIssueScope: @retroactive Identifiable {
  public static let all: [Self] = [.assigned, .created, .subscribed]
  public var id: String { rawValue }

  public var title: String {
    switch self {
    case .created: "Created"
    case .subscribed: "Subscribed"
    default: "Assigned"
    }
  }

  /// What an empty board says for this scope.
  public var emptyText: String {
    switch self {
    case .created: "Open issues you created in Linear show up here."
    case .subscribed: "Open issues you're subscribed to in Linear show up here."
    default: "Open issues assigned to you in Linear show up here."
    }
  }
}

extension ArgusProtocol.LinearIssue {
  /// The detail as the card and the board read it.
  public init(_ detail: ArgusProtocol.LinearIssueDetail) {
    self.init(
      id: detail.id, identifier: detail.identifier, title: detail.title, description: detail.description,
      url: detail.url, branchName: detail.branchName, state: detail.state, priority: detail.priority,
      estimate: detail.estimate, estimateType: detail.estimateType,
      labelColors: detail.labelColors?.map { .init(name: $0.name, color: $0.color) }, teamId: detail.teamId, teamKey: detail.teamKey, teamName: detail.teamName,
      assignee: detail.assignee, assigneeAvatarUrl: detail.assigneeAvatarUrl, labels: detail.labels,
      project: detail.project.map { .init(id: $0.id, name: $0.name) },
      cycle: detail.cycle.map { .init(id: $0.id, number: $0.number, name: $0.name, isActive: $0.isActive) },
      parent: detail.parent.map { .init(identifier: $0.identifier, title: $0.title) },
      pullRequestCount: detail.pullRequestCount, createdAt: detail.createdAt, updatedAt: detail.updatedAt)
  }
}

/// How the Issues screen lays Linear out: a column per workflow state, a
/// swimlane per priority, and which session is on an issue — the desktop's
/// `app/lib/issueBoard.ts`.
public enum LinearIssueBoard {
  public typealias Issue = ArgusProtocol.LinearIssue

  public struct Column: Identifiable {
    /// The state's name, lowercased: same-named states across teams share it.
    public let id: String
    public let name: String
    /// Linear's category, for the column's glyph.
    public let type: String
    /// Linear's own `#rrggbb` for the state, when it sent one.
    public let color: String?
    /// Empty for a state of the team's workflow no issue is in.
    public let issues: [Issue]
  }

  public struct Lane: Identifiable {
    public let priority: Int
    public let count: Int
    public var id: Int { priority }
    public var title: String { LinearIssueBoard.priorityLabel(priority) }
  }

  /// Linear's state categories in the order work flows through them.
  static let typeOrder = [
    "triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate",
  ]

  /// Done, canceled and duplicate stay hidden until shown, like Linear's "My issues".
  static let hiddenByDefault: Set<String> = ["canceled", "completed", "duplicate"]

  /// `overrides` maps a column id to an explicit hide (true) or show (false);
  /// otherwise a column shows when it has issues and isn't a closed state.
  public static func isHidden(_ column: Column, overrides: [String: Bool]) -> Bool {
    overrides[column.id] ?? (column.issues.isEmpty || hiddenByDefault.contains(column.type))
  }

  /// Urgent first, "no priority" last — Linear's own order.
  public static let priorityOrder = [1, 2, 3, 4, 0]

  /// One column per state the issues are in, plus every state in `states`
  /// (the teams' workflows), in workflow order.
  public static func columns(_ issues: [Issue], states: [ArgusProtocol.LinearWorkflowState] = []) -> [Column] {
    var order: [String] = []
    var byKey: [String: (state: ArgusProtocol.LinearWorkflowState, issues: [Issue])] = [:]
    func add(_ state: ArgusProtocol.LinearWorkflowState) -> String {
      let key = state.name.lowercased()
      if byKey[key] == nil {
        order.append(key)
        byKey[key] = (state, [])
      } else if byKey[key]?.state.color == nil {
        byKey[key]?.state.color = state.color
      }
      return key
    }
    for state in states { _ = add(state) }
    for issue in issues { byKey[add(issue.state)]?.issues.append(issue) }
    return order.compactMap { key in byKey[key].map { (key, $0.state, $0.issues) } }
      .sorted { a, b in
        let (ra, rb) = (typeRank(a.1.type), typeRank(b.1.type))
        return ra != rb ? ra < rb : a.1.position < b.1.position
      }
      .map { Column(id: $0.0, name: $0.1.name, type: $0.1.type, color: $0.1.color, issues: $0.2) }
  }

  /// A lane per priority that has issues, most urgent first.
  public static func lanes(_ issues: [Issue]) -> [Lane] {
    priorityOrder.compactMap { priority in
      let count = issues.filter { Int($0.priority) == priority }.count
      return count == 0 ? nil : Lane(priority: priority, count: count)
    }
  }

  /// One board cell: the column's issues in the lane, most recent first.
  public static func cell(_ column: Column, lane: Lane) -> [Issue] {
    column.issues.filter { Int($0.priority) == lane.priority }.sorted(by: byPriority)
  }

  /// Most urgent first, then most recently touched.
  public static func byPriority(_ a: Issue, _ b: Issue) -> Bool {
    let (ra, rb) = (priorityRank(a.priority), priorityRank(b.priority))
    return ra != rb ? ra < rb : a.updatedAt > b.updatedAt
  }

  public static func priorityLabel(_ value: Int) -> String {
    switch value {
    case 1: "Urgent"
    case 2: "High"
    case 3: "Medium"
    case 4: "Low"
    default: "No priority"
    }
  }

  /// Nil for "No priority" (0) and anything Linear adds later.
  public static func priority(_ value: Double) -> String? {
    (1...4).contains(Int(value)) ? priorityLabel(Int(value)) : nil
  }

  /// Urgent and High stand out.
  public static func isPressing(_ value: Double) -> Bool {
    (1...2).contains(Int(value))
  }

  /// "Sprint 4", or "Cycle 59" when the cycle has no name.
  public static func cycleLabel(number: Double, name: String?) -> String {
    if let name, !name.isEmpty { return name }
    return "Cycle \(Int(number))"
  }

  public static func cycleLabel(_ issue: Issue) -> String? {
    issue.cycle.map { cycleLabel(number: $0.number, name: $0.name) }
  }

  /// Linear stores t-shirt sizes as these numbers — `estimateName` in `linearLabels.ts`.
  static let tShirt: [Double: String] = [
    0: "None", 1: "XS", 2: "S", 3: "M", 5: "L", 8: "XL", 13: "XXL", 21: "XXXL",
  ]

  /// `M` on a t-shirt team, `3 pt` elsewhere, without a trailing ".0"; `unit`
  /// false drops the " pt" for a card that draws its own estimate glyph.
  public static func estimateLabel(_ estimate: Double, type: String? = nil, unit: Bool = true) -> String {
    if type == "tShirt", let size = tShirt[estimate] { return size }
    let points = estimate.rounded() == estimate ? String(Int(estimate)) : String(estimate)
    return unit ? "\(points) pt" : points
  }

  /// The order the list reads in: a status at a time, most urgent first.
  public static func listOrder(_ issues: [Issue]) -> [Issue] {
    columns(issues).flatMap { $0.issues.sorted(by: byPriority) }
  }

  /// The order the board reads in: lane by lane, left to right across `columns`.
  public static func boardOrder(_ columns: [Column]) -> [Issue] {
    lanes(columns.flatMap(\.issues)).flatMap { lane in columns.flatMap { cell($0, lane: lane) } }
  }

  public static func date(_ epochMs: Double) -> Date {
    Date(timeIntervalSince1970: epochMs / 1000)
  }

  /// Started from the issue, or a worktree on its Linear branch name.
  public static func session(
    for issue: Issue, in sessions: some Sequence<RemoteSession>
  ) -> RemoteSession? {
    session(identifier: issue.identifier, branchName: issue.branchName, in: sessions)
  }

  public static func session(
    identifier: String, branchName: String, in sessions: some Sequence<RemoteSession>
  ) -> RemoteSession? {
    sessions.first {
      $0.linkedIssue?.identifier == identifier
        || ($0.kind == .worktree && $0.branch == branchName)
    }
  }

  static func typeRank(_ type: String) -> Int {
    typeOrder.firstIndex(of: type) ?? typeOrder.count
  }

  static func priorityRank(_ value: Double) -> Int {
    priorityOrder.firstIndex(of: Int(value)) ?? priorityOrder.count
  }
}
