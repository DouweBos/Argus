import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct LinearIssueBoardTests {
  private func issue(
    _ id: String, type: String, state: String? = nil, position: Double = 0, priority: Double = 0,
    updatedAt: Double = 0
  ) -> ArgusProtocol.LinearIssue {
    .init(
      id: id, identifier: id, title: "t", description: "", url: "https://linear.app/x/\(id)",
      branchName: "\(id.lowercased())-fix",
      state: .init(id: "\(id)-state", name: state ?? type, type: type, position: position),
      priority: priority, teamId: "t", teamKey: "ENG", teamName: "Engineering", labels: [],
      pullRequestCount: 0, createdAt: 0, updatedAt: updatedAt)
  }

  private func session(_ json: String) throws -> RemoteSession {
    try JSONDecoder().decode(RemoteSession.self, from: Data(json.utf8))
  }

  @Test func columnsFollowTheWorkflow() {
    let columns = LinearIssueBoard.columns([
      issue("ENG-1", type: "started", state: "In Review", position: 3),
      issue("ENG-2", type: "backlog"),
      issue("ENG-3", type: "started", state: "In Progress", position: 2),
      issue("ENG-4", type: "completed", state: "Done"),
      issue("ENG-5", type: "triage"),
    ])

    #expect(columns.map(\.name) == ["triage", "backlog", "In Progress", "In Review", "Done"])
  }

  @Test func sameNamedStatesShareAColumn() {
    let columns = LinearIssueBoard.columns([
      issue("ENG-1", type: "started", state: "In Progress"),
      issue("APP-2", type: "started", state: "in progress"),
    ])

    #expect(columns.count == 1)
    #expect(columns[0].issues.map(\.identifier) == ["ENG-1", "APP-2"])
  }

  @Test func lanesSkipEmptyPrioritiesAndPutNoneLast() {
    let issues = [
      issue("ENG-1", type: "started", priority: 0), issue("ENG-2", type: "started", priority: 3),
      issue("ENG-3", type: "backlog", priority: 1), issue("ENG-4", type: "backlog", priority: 3),
    ]
    let lanes = LinearIssueBoard.lanes(issues)

    #expect(lanes.map(\.priority) == [1, 3, 0])
    #expect(lanes.map(\.count) == [1, 2, 1])
    #expect(lanes.map(\.title) == ["Urgent", "Medium", "No priority"])
  }

  @Test func cellsHoldTheirLaneNewestFirst() throws {
    let issues = [
      issue("ENG-1", type: "started", priority: 2, updatedAt: 1),
      issue("ENG-2", type: "started", priority: 2, updatedAt: 5),
      issue("ENG-3", type: "started", priority: 4),
    ]
    let column = try #require(LinearIssueBoard.columns(issues).first)
    let high = try #require(LinearIssueBoard.lanes(issues).first)

    #expect(LinearIssueBoard.cell(column, lane: high).map(\.identifier) == ["ENG-2", "ENG-1"])
  }

  @Test func labelsCyclesAndEstimates() {
    #expect(LinearIssueBoard.cycleLabel(number: 59, name: nil) == "Cycle 59")
    #expect(LinearIssueBoard.cycleLabel(number: 59, name: "Sprint 4") == "Sprint 4")
    #expect(LinearIssueBoard.estimateLabel(3) == "3 pt")
    #expect(LinearIssueBoard.estimateLabel(0.5) == "0.5 pt")
    #expect(LinearIssueBoard.estimateLabel(3, unit: false) == "3")
  }

  @Test func namesPriorities() {
    #expect(LinearIssueBoard.priority(1) == "Urgent")
    #expect(LinearIssueBoard.priority(4) == "Low")
    #expect(LinearIssueBoard.priority(0) == nil)
    #expect(LinearIssueBoard.isPressing(2))
    #expect(!LinearIssueBoard.isPressing(3))
  }

  @Test func findsTheSessionOnAnIssue() throws {
    let linked = try session(
      #"{"id":"a","repo_root":"/r","kind":"worktree","branch":"other","status":"ready","linked_issue":{"identifier":"ENG-1","title":"t","url":"u"}}"#
    )
    let byBranch = try session(#"{"id":"b","repo_root":"/r","kind":"worktree","branch":"eng-2-fix","status":"ready"}"#)
    let root = try session(#"{"id":"c","repo_root":"/r","kind":"project_root","branch":"eng-3-fix","status":"ready"}"#)
    let sessions = [linked, byBranch, root]

    #expect(LinearIssueBoard.session(for: issue("ENG-1", type: "started"), in: sessions)?.id == "a")
    #expect(LinearIssueBoard.session(for: issue("ENG-2", type: "started"), in: sessions)?.id == "b")
    // A checkout that happens to be on the branch isn't a session started for it.
    #expect(LinearIssueBoard.session(for: issue("ENG-3", type: "started"), in: sessions) == nil)
  }

  @Test func hidesEmptyAndClosedColumnsUntilShown() {
    let columns = LinearIssueBoard.columns(
      [issue("ENG-1", type: "backlog"), issue("ENG-2", type: "unstarted"), issue("ENG-3", type: "duplicate")],
      states: [.init(id: "s", name: "Blocked", type: "started", position: 9)])
    let hidden = { (overrides: [String: Bool]) in
      columns.filter { LinearIssueBoard.isHidden($0, overrides: overrides) }.map(\.name)
    }

    #expect(hidden([:]) == ["Blocked", "duplicate"])
    #expect(hidden(["blocked": false, "unstarted": true]) == ["unstarted", "duplicate"])
  }

  @Test func workflowStatesAddEmptyColumnsMergedAcrossTeams() {
    let columns = LinearIssueBoard.columns(
      [issue("ENG-1", type: "started", state: "In Progress", position: 2)],
      states: [
        .init(id: "a", name: "Done", type: "completed", position: 5),
        .init(id: "b", name: "In Progress", type: "started", position: 2),
        .init(id: "c", name: "in progress", type: "started", position: 2, color: "#f2c94c"),
        .init(id: "d", name: "Todo", type: "unstarted", position: 1, color: "#e2e2e2"),
      ])

    #expect(columns.map(\.name) == ["Todo", "In Progress", "Done"])
    #expect(columns.map(\.issues.count) == [0, 1, 0])
    #expect(columns[1].color == "#f2c94c")
  }
}
