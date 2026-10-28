import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct LinearIssueBoardTests {
  private func issue(_ id: String, type: String, priority: Double = 0) -> ArgusProtocol.LinearIssue {
    .init(
      id: id, identifier: id, title: "t", description: "", url: "https://linear.app/x/\(id)",
      branchName: "\(id.lowercased())-fix", state: .init(name: type, type: type), priority: priority,
      teamKey: "ENG", labels: [], updatedAt: 0)
  }

  private func session(_ json: String) throws -> RemoteSession {
    try JSONDecoder().decode(RemoteSession.self, from: Data(json.utf8))
  }

  @Test func groupsByStateInWorkOrder() {
    let groups = LinearIssueBoard.groups([
      issue("ENG-1", type: "backlog"), issue("ENG-2", type: "started"),
      issue("ENG-3", type: "triage"), issue("ENG-4", type: "completed"),
    ])

    #expect(groups.map(\.title) == ["In progress", "Backlog"])
    #expect(groups[1].issues.map(\.identifier) == ["ENG-1", "ENG-3"])
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
}
