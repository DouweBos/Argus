import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

/// Mirrors `app/lib/issueFilters.test.ts`: desktop and Mac have to agree.
struct IssueFiltersTests {
  private static let now = Date(timeIntervalSince1970: 1_793_275_200)  // 2026-10-29T12:00:00Z
  private static let nowMs = now.timeIntervalSince1970 * 1000
  private static let day: Double = 24 * 60 * 60 * 1000

  private static func issue(
    _ id: String, title: String = "Fix login", priority: Double = 0, labels: [String] = [],
    cycle: ArgusProtocol.LinearIssueCycle? = nil, createdAt: Double = nowMs
  ) -> ArgusProtocol.LinearIssue {
    .init(
      id: id, identifier: id, title: title, description: "", url: "", branchName: "eng-1",
      state: .init(id: "s", name: "Todo", type: "unstarted", position: 1), priority: priority,
      teamId: "t", teamKey: "ENG", teamName: "Engineering", labels: labels, cycle: cycle,
      pullRequestCount: 0, createdAt: createdAt, updatedAt: nowMs)
  }

  private let issues = [
    issue("A", priority: 1, labels: ["Bug", "iOS"], cycle: .init(id: "c", number: 59, isActive: true)),
    issue("B", priority: 2, labels: ["Bug"], cycle: .init(id: "d", number: 58, isActive: false)),
    issue("C", title: "Casting crash", priority: 2, createdAt: nowMs - 40 * day),
  ]

  private func ids(_ filters: [IssueFilter]) -> [String] {
    IssueFilters.apply(issues, filters, now: Self.now).map(\.identifier)
  }

  @Test func matchesAnyValueWithinAFilterAndEveryFilter() {
    #expect(ids([.init(field: .priority, values: ["1", "2"])]) == ["A", "B", "C"])
    #expect(ids([.init(field: .priority, values: ["2"]), .init(field: .labels, values: ["Bug"])]) == ["B"])
    #expect(ids([.init(field: .labels, negate: true, values: ["Bug"])]) == ["C"])
    #expect(ids([IssueFilters.currentCycle]) == ["A"])
    #expect(ids([.init(field: .content, values: ["casting"])]) == ["C"])
    #expect(ids([.init(field: .created, values: ["30d"])]) == ["A", "B"])
  }

  @Test func countsEachOptionAndListsFixedOnesFirst() {
    let cycle = IssueFilters.options(.cycle, issues: issues, now: Self.now)
    #expect(cycle.map(\.label) == ["Current cycle", "Cycle 58", "Cycle 59", "No cycle"])
    #expect(cycle.map(\.count) == [1, 1, 1, 1])
    #expect(IssueFilters.options(.priority, issues: issues, now: Self.now).map(\.count) == [1, 2, 0, 0, 0])
  }

  @Test func namesTheEmptyOptionAfterTheField() {
    #expect(IssueFilters.optionLabel(.labels, "__none__") == "No labels")
  }

  @Test func summarisesAChip() {
    #expect(IssueFilters.summary(.init(field: .priority, values: ["1", "2"])) == "Urgent, High")
    #expect(IssueFilters.summary(.init(field: .labels, values: ["a", "b", "c"])) == "3 labels")
    #expect(IssueFilters.operatorLabel(.init(field: .content, negate: true, values: ["x"])) == "doesn't contain")
  }

  @Test func keepsAChangedFilterInPlaceAndDropsAnEmptyOne() {
    var filters = IssueFilters.toggling([], .priority, "1")
    filters = IssueFilters.toggling(filters, .labels, "Bug")
    filters = IssueFilters.toggling(filters, .priority, "2")
    #expect(filters.map(\.field) == [.priority, .labels])
    #expect(filters[0].values == ["1", "2"])
    filters = IssueFilters.toggling(filters, .labels, "Bug")
    #expect(filters.map(\.field) == [.priority])
  }

  @Test @MainActor func carriesTheCurrentCycleToggleOverOnce() throws {
    let defaults = try #require(UserDefaults(suiteName: "IssueFiltersTests.\(UUID())"))
    defaults.set(true, forKey: LinearIssuesModel.legacyCycleKey)

    #expect(LinearIssuesModel.load(from: defaults) == ["assigned": [IssueFilters.currentCycle]])
    #expect(defaults.object(forKey: LinearIssuesModel.legacyCycleKey) == nil)

    LinearIssuesModel.save(["assigned": []], to: defaults)
    #expect(LinearIssuesModel.load(from: defaults) == ["assigned": []])
  }
}
