import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@MainActor
struct IssueFilterMenuTests {
  private static func issue(_ id: String, priority: Double, labels: [String] = []) -> ArgusProtocol.LinearIssue {
    .init(
      id: id, identifier: id, title: "t", description: "", url: "", branchName: "b",
      state: .init(id: "s", name: "Todo", type: "unstarted", position: 1), priority: priority,
      teamId: "t", teamKey: "ENG", teamName: "Engineering", labels: labels,
      pullRequestCount: 0, createdAt: 0, updatedAt: 0)
  }

  private final class Box {
    var filters: [IssueFilter] = []
  }

  private func menu(_ box: Box, field: IssueFilter.Field? = nil) -> IssueFilterMenu {
    IssueFilterMenu(
      issues: [Self.issue("A", priority: 1, labels: ["Bug"]), Self.issue("B", priority: 2)], field: field,
      filters: { box.filters }, apply: { box.filters = $0 })
  }

  @Test func searchesFieldsAndOpensTheHighlightedOne() {
    let box = Box()
    let menu = menu(box)
    menu.fieldQuery = "pri"
    #expect(menu.fieldGroups.flatMap { $0 } == [.priority])
    #expect(menu.submit() == false)
    #expect(menu.field == .priority)
  }

  @Test func splitsOutOptionsNoIssueMatches() {
    let box = Box()
    let menu = menu(box, field: .priority)
    #expect(menu.options.shown.map(\.value) == ["1", "2"])
    #expect(menu.options.unmatched.map(\.value) == ["3", "4", "0"])
    menu.showsUnmatched = true
    #expect(menu.options.shown.count == 5)
    #expect(menu.options.unmatched.isEmpty)
  }

  @Test func returnTicksTheHighlightedValueAndCloses() {
    let box = Box()
    let menu = menu(box, field: .priority)
    menu.move(1)
    menu.move(1)
    #expect(menu.submit())
    #expect(box.filters == [.init(field: .priority, values: ["2"])])
  }

  @Test func escapeGoesBackOnlyWhenOpenedFromTheFields() {
    let box = Box()
    let fromFields = menu(box)
    fromFields.open(.labels)
    #expect(fromFields.back())
    #expect(fromFields.field == nil)
    #expect(!menu(box, field: .labels).back())
  }

  @Test func textFieldsFilterOnWhatsTyped() {
    let box = Box()
    let menu = menu(box, field: .content)
    menu.valueQuery = "crash"
    #expect(menu.submit())
    #expect(box.filters == [.init(field: .content, values: ["crash"])])
  }
}
