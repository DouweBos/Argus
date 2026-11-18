import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func session(_ id: String, at: Double? = nil, extra: [String: Any] = [:]) -> RemoteSession {
  var json: [String: Any] = ["id": id, "repo_root": "/r", "kind": "worktree", "branch": "b-\(id)", "status": "ready"]
  json["last_message_at"] = at
  json.merge(extra) { $1 }
  return try! JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: json))
}

private func run(_ id: String, slot: Int) -> [String: Any] {
  ["compare_group": ["id": id, "slot": slot, "runner_id": "claude"]]
}

@Suite("Session recency")
struct SessionRecencyTests {
  @Test func newestFirstAndUnstampedLastInTheirOrder() {
    let sorted = SessionRecency.sorted([session("a"), session("old", at: 1), session("b"), session("new", at: 3)])
    #expect(sorted.map(\.id) == ["new", "old", "a", "b"])
  }

  @Test func aCompareRunSortsByItsNewestSlotAndStaysTogether() {
    let sorted = SessionRecency.sorted([
      session("x", at: 5),
      session("slot1", at: 1, extra: run("r", slot: 0)),
      session("y", at: 3),
      session("slot2", at: 9, extra: run("r", slot: 1)),
    ])
    #expect(sorted.map(\.id) == ["slot1", "slot2", "x", "y"])
  }

  @Test func aStackSortsByItsNewestSessionWithTheParentFirst() {
    let sorted = SessionRecency.sorted([
      session("x", at: 5),
      session("parent", at: 1),
      session("child", at: 9, extra: ["parent_session_id": "parent"]),
    ])
    #expect(sorted.map(\.id) == ["parent", "child", "x"])
  }

  @Test func triageSortsEachGroupAndKeepsThePhoneRootOnTop() {
    let sessions = [session("a", at: 1), session("b", at: 2), session("c")]
    #expect(SessionTriage(sessions) { _ in [] }.active.map(\.id) == ["b", "a", "c"])
    let root = session("root", extra: ["kind": "project_root"])
    let groups = SessionGroup.make(sessions: [root] + sessions, agents: [])
    #expect(SessionGroupTriage(groups).active.map(\.id) == ["root", "b", "a", "c"])
  }
}
