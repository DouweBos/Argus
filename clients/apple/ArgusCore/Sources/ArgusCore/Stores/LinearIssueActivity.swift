import ArgusKit
import Foundation

/// An issue's activity the way Linear lays it out: comment threads as cards,
/// history as one-line events, long runs of events folded into "Show N events".
public enum LinearIssueActivity {
  public typealias Comment = ArgusProtocol.LinearComment
  public typealias Event = ArgusProtocol.LinearHistoryEvent

  /// A top-level comment and its replies, oldest first.
  public struct Thread: Identifiable {
    public let root: Comment
    public let replies: [Comment]
    public var id: String { root.id ?? "\(root.createdAt)-\(root.author ?? "")" }
    /// What a reply in this thread hangs off; nil when Linear didn't say.
    public var replyTarget: String? { root.id }
  }

  public enum Item: Identifiable {
    case event(Event)
    /// Events folded away until asked for; `id` is the first one's.
    case folded([Event])
    case thread(Thread)

    public var id: String {
      switch self {
      case .event(let event): "e-\(event.id)"
      case .folded(let events): "f-\(events.first?.id ?? "")"
      case .thread(let thread): "t-\(thread.id)"
      }
    }
  }

  /// Comments grouped under their thread's first comment. A reply whose
  /// parent isn't here starts its own thread rather than vanishing.
  public static func threads(_ comments: [Comment]) -> [Thread] {
    let sorted = comments.sorted { $0.createdAt < $1.createdAt }
    let ids = Set(sorted.compactMap(\.id))
    var parentOf: [String: String] = [:]
    for comment in sorted { if let id = comment.id, let parent = comment.parentId { parentOf[id] = parent } }
    func root(of comment: Comment) -> String? {
      var current = comment.parentId
      var seen: Set<String> = []
      while let id = current, ids.contains(id), seen.insert(id).inserted {
        guard let next = parentOf[id] else { return id }
        current = next
      }
      return nil
    }
    var replies: [String: [Comment]] = [:]
    var roots: [Comment] = []
    for comment in sorted {
      if let rootId = root(of: comment) { replies[rootId, default: []].append(comment) } else { roots.append(comment) }
    }
    return roots.map { Thread(root: $0, replies: $0.id.flatMap { replies[$0] } ?? []) }
  }

  /// Events and threads in one timeline, oldest first. A run of more than
  /// `foldAbove` events keeps its first and last two and folds the middle.
  public static func timeline(history: [Event], comments: [Comment], foldAbove: Int = 4) -> [Item] {
    let threads = threads(comments)
    var merged: [(at: Double, item: Item)] = history.map { ($0.createdAt, .event($0)) }
    merged += threads.map { ($0.root.createdAt, .thread($0)) }
    // Stable: an event and a comment at the same instant keep event-first.
    let ordered = merged.enumerated().sorted { a, b in
      a.element.at != b.element.at ? a.element.at < b.element.at : a.offset < b.offset
    }.map(\.element.item)

    var out: [Item] = []
    var run: [Event] = []
    func flush() {
      if run.count > foldAbove {
        out.append(.event(run[0]))
        out.append(.folded(Array(run[1..<(run.count - 2)])))
        out += run.suffix(2).map(Item.event)
      } else {
        out += run.map(Item.event)
      }
      run = []
    }
    for item in ordered {
      if case .event(let event) = item {
        run.append(event)
      } else {
        flush()
        out.append(item)
      }
    }
    flush()
    return out
  }

  /// "Show 3 events: changed status, assignee, and cycles".
  public static func foldedSummary(_ events: [Event]) -> String {
    var nouns: [String] = []
    for event in events {
      if let noun = noun(event.kind), !nouns.contains(noun) { nouns.append(noun) }
    }
    let head = "Show \(events.count) events"
    guard !nouns.isEmpty else { return head }
    let list: String
    switch nouns.count {
    case 1: list = nouns[0]
    case 2: list = "\(nouns[0]) and \(nouns[1])"
    default: list = nouns.dropLast().joined(separator: ", ") + ", and \(nouns.last!)"
    }
    return "\(head): changed \(list)"
  }

  /// "Linear moved the issue…" when no person did it.
  public static func sentence(_ event: Event) -> String {
    "\(event.actor ?? "Linear") \(event.text)"
  }

  static func noun(_ kind: ArgusProtocol.LinearHistoryEventKind) -> String? {
    switch kind {
    case .status: "status"
    case .priority: "priority"
    case .assignee: "assignee"
    case .estimate: "estimate"
    case .cycle: "cycles"
    case .project: "project"
    case .labels: "labels"
    case .title: "title"
    case .description: "description"
    case .due: "due date"
    case .parent: "parent"
    case .relation: "relations"
    case .attachment: "links"
    default: nil
    }
  }

  public struct RelationGroup: Identifiable {
    public let title: String
    public let issues: [ArgusProtocol.LinearIssueDetailRelationsItem]
    public var id: String { title }
  }

  /// Blockers first, then what this blocks, related, duplicates and similar.
  public static func relationGroups(_ relations: [ArgusProtocol.LinearIssueDetailRelationsItem]) -> [RelationGroup] {
    let order: [(String, String)] = [
      ("blocked_by", "Blocked by"), ("blocks", "Blocking"), ("related", "Related"),
      ("duplicate_of", "Duplicate of"), ("duplicate", "Duplicated by"), ("similar", "Similar"),
    ]
    let known = Set(order.map(\.0))
    var groups = order.compactMap { type, title -> RelationGroup? in
      let issues = relations.filter { $0.type == type }
      return issues.isEmpty ? nil : RelationGroup(title: title, issues: issues)
    }
    let other = relations.filter { !known.contains($0.type) }
    if !other.isEmpty { groups.append(RelationGroup(title: "Linked", issues: other)) }
    return groups
  }

  /// Where an issue sits in an ordered list, and its neighbours.
  public struct Position: Equatable {
    public let index: Int
    public let total: Int
    public let previous: String?
    public let next: String?

    public init(index: Int, total: Int, previous: String?, next: String?) {
      (self.index, self.total, self.previous, self.next) = (index, total, previous, next)
    }
  }

  public static func position(of identifier: String, in order: [String]) -> Position? {
    guard let index = order.firstIndex(of: identifier) else { return nil }
    return Position(
      index: index, total: order.count,
      previous: index > 0 ? order[index - 1] : nil,
      next: index + 1 < order.count ? order[index + 1] : nil)
  }
}
