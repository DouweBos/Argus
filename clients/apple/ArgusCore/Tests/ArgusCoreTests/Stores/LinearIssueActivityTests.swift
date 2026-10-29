import ArgusCore
import ArgusKit
import Testing

@Suite("Linear issue activity")
struct LinearIssueActivityTests {
  typealias Comment = ArgusProtocol.LinearComment
  typealias Event = ArgusProtocol.LinearHistoryEvent

  private func comment(_ id: String, parent: String? = nil, at: Double) -> Comment {
    Comment(id: id, parentId: parent, author: "ann", body: id, createdAt: at)
  }

  private func event(_ id: String, _ kind: ArgusProtocol.LinearHistoryEventKind = .status, at: Double) -> Event {
    Event(id: id, createdAt: at, actor: nil, kind: kind, text: "did \(id)")
  }

  @Test("replies hang off their thread's first comment, nested replies too")
  func threads() {
    let threads = LinearIssueActivity.threads([
      comment("r2", parent: "r1", at: 3), comment("a", at: 1), comment("r1", parent: "a", at: 2),
      comment("b", at: 4), comment("orphan", parent: "gone", at: 5),
    ])
    #expect(threads.map(\.root.id) == ["a", "b", "orphan"])
    #expect(threads[0].replies.map(\.id) == ["r1", "r2"])
    #expect(threads[1].replies.isEmpty)
  }

  @Test("events and threads interleave by time, long runs fold their middle")
  func timeline() {
    let history = (1...6).map { event("e\($0)", at: Double($0)) } + [event("late", at: 20)]
    let items = LinearIssueActivity.timeline(history: history, comments: [comment("c", at: 10)])
    #expect(items.map(\.id) == ["e-e1", "f-e2", "e-e5", "e-e6", "t-c", "e-late"])
    if case .folded(let events) = items[1] { #expect(events.map(\.id) == ["e2", "e3", "e4"]) }
  }

  @Test("short runs stay as they are")
  func shortRun() {
    let items = LinearIssueActivity.timeline(history: (1...4).map { event("e\($0)", at: Double($0)) }, comments: [])
    #expect(items.count == 4)
  }

  @Test("a folded run names what changed, once each")
  func summary() {
    let events = [event("1", .status, at: 1), event("2", .assignee, at: 2), event("3", .status, at: 3), event("4", .cycle, at: 4)]
    #expect(LinearIssueActivity.foldedSummary(events) == "Show 4 events: changed status, assignee, and cycles")
    #expect(LinearIssueActivity.foldedSummary([event("1", .other, at: 1), event("2", .created, at: 2)]) == "Show 2 events")
  }

  @Test("Linear itself speaks when there's no actor")
  func sentence() {
    #expect(LinearIssueActivity.sentence(event("x", at: 1)) == "Linear did x")
  }

  @Test("relations group blockers first")
  func relations() {
    let state = ArgusProtocol.LinearIssueDetailRelationsItemState(name: "Todo", type: "unstarted")
    let groups = LinearIssueActivity.relationGroups([
      .init(type: "related", identifier: "A-1", title: "a", state: state),
      .init(type: "blocked_by", identifier: "A-2", title: "b", state: state),
    ])
    #expect(groups.map(\.title) == ["Blocked by", "Related"])
  }

  @Test("an issue's place in the list and its neighbours")
  func position() {
    let order = ["A-1", "A-2", "A-3"]
    #expect(LinearIssueActivity.position(of: "A-1", in: order)?.previous == nil)
    #expect(LinearIssueActivity.position(of: "A-2", in: order) == .init(index: 1, total: 3, previous: "A-1", next: "A-3"))
    #expect(LinearIssueActivity.position(of: "B-1", in: order) == nil)
  }

  @Test("t-shirt teams size, everyone else counts points")
  func estimates() {
    #expect(LinearIssueBoard.estimateLabel(3, type: "tShirt") == "M")
    #expect(LinearIssueBoard.estimateLabel(3, type: "fibonacci") == "3 pt")
    #expect(LinearIssueBoard.estimateLabel(4, type: "tShirt") == "4 pt")
  }
}
