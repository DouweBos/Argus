import ArgusCore
import ArgusKit
import Testing

@Suite("Linear issue properties")
@MainActor
struct LinearIssuePropertyTests {
  private let day = 86_400_000.0

  private func entry(_ name: String, _ type: String, at days: Double) -> LinearIssueProperty.StatusEntry {
    .init(name: name, type: type, enteredAt: days * day)
  }

  @Test("sums each status's time, including returns to it")
  func timeInStatus() {
    let stints = LinearIssueProperty.timeInStatus(
      [
        entry("Triage", "triage", at: 0), entry("Todo", "unstarted", at: 5),
        entry("In Progress", "started", at: 7), entry("Todo", "unstarted", at: 8),
      ],
      now: 10 * day)
    #expect(stints.map(\.name) == ["Triage", "Todo", "In Progress"])
    #expect(stints.map { $0.duration / day } == [5, 4, 1])
  }

  @Test("uses Linear's short units")
  func shortDuration() {
    #expect(LinearIssueProperty.shortDuration(5 * day) == "5d")
    #expect(LinearIssueProperty.shortDuration(300 * day) == "10mo")
    #expect(LinearIssueProperty.shortDuration(30_000) == "<1m")
  }

  @Test("statuses are keyed 1 to 9, then 0, then not at all")
  func statusKeys() {
    let states = (0..<12).map { ArgusProtocol.LinearWorkflowState(id: "s\($0)", name: "S\($0)", type: "unstarted", position: Double($0)) }
    let keys = LinearIssueProperty.statusOptions(states).map(\.key)
    #expect(keys == ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", nil, nil])
  }

  @Test("statuses follow the workflow, not the team's raw order")
  func statusOrder() {
    let states = [
      ("Done", "completed", 1.0), ("Ready for QA", "completed", 0.0), ("In Review", "started", 3.0),
      ("Todo", "unstarted", 0.0), ("Backlog", "backlog", 0.0), ("Triage", "triage", 0.0),
    ].map { ArgusProtocol.LinearWorkflowState(id: $0.0, name: $0.0, type: $0.1, position: $0.2) }
    #expect(LinearIssueProperty.statusOptions(states).map(\.title)
      == ["Triage", "Backlog", "Todo", "In Review", "Ready for QA", "Done"])
  }

  @Test("priorities run urgent to low, then none, keyed by their number")
  func priorityKeys() {
    let options = LinearIssueProperty.priorityOptions
    #expect(options.map(\.title) == ["Urgent", "High", "Medium", "Low", "No priority"])
    #expect(options.map(\.key) == ["1", "2", "3", "4", "0"])
  }

  @Test("the last change of a kind is the newest one")
  func lastChange() {
    let history: [LinearIssueProperty.Event] = [
      .init(id: "a", createdAt: 1, actor: "ann", kind: .priority, text: "set priority"),
      .init(id: "b", createdAt: 3, actor: "bob", kind: .priority, text: "set priority"),
      .init(id: "c", createdAt: 5, actor: "cy", kind: .status, text: "moved"),
    ]
    #expect(LinearIssueProperty.lastChange(.priority, in: history)?.id == "b")
    #expect(LinearIssueProperty.lastChange(.assignee, in: history) == nil)
    #expect(LinearIssueProperty.lastChange(.cycle, in: nil) == nil)
  }

  @Test("typing filters, arrows wrap, Return takes the highlight or the top match")
  func menu() {
    let menu = LinearPropertyMenu(options: LinearIssueProperty.priorityOptions)
    menu.query = "ur"
    #expect(menu.visible.map(\.title) == ["Urgent"])
    #expect(menu.submission?.id == "1")
    menu.query = ""
    menu.move(-1)
    #expect(menu.highlighted == "0")
    menu.move(1)
    #expect(menu.highlighted == "1")
    #expect(menu.submission?.id == "1")
    menu.query = "zzz"
    #expect(menu.submission == nil)
    #expect(menu.option(forKey: "3")?.title == "Medium")
  }
}
