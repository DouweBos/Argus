import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func session(_ id: String, parent: String? = nil, compare: (String, Int)? = nil) -> RemoteSession {
  var json: [String: Any] = [
    "id": id, "repo_root": "/r", "kind": "worktree", "branch": id, "status": "ready",
  ]
  if let parent { json["parent_session_id"] = parent }
  if let compare { json["compare_group"] = ["id": compare.0, "slot": compare.1] }
  return try! JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: json))
}

@Suite("Session stacks")
struct SessionStackTests {
  @Test("stacked sessions follow their parent, indented by depth")
  func ordersUnderParents() {
    let sessions = [session("c", parent: "b"), session("x"), session("a"), session("b", parent: "a")]
    let ordered = SessionStack.ordered(sessions)
    #expect(ordered.map(\.id) == ["x", "a", "b", "c"])
    #expect(ordered.map(\.depth) == [0, 0, 1, 2])
  }

  @Test("a child whose parent is gone stays at the top level")
  func orphanAtTop() {
    let ordered = SessionStack.ordered([session("b", parent: "gone")])
    #expect(ordered.map(\.depth) == [0])
  }

  @Test("a parent cycle keeps every session")
  func cycleKept() {
    let ordered = SessionStack.ordered([session("a", parent: "b"), session("b", parent: "a")])
    #expect(Set(ordered.map(\.id)) == ["a", "b"])
  }

  @Test("members are the whole stack, bottom first, from any of its sessions")
  func members() {
    let sessions = [session("a"), session("b", parent: "a"), session("c", parent: "b"), session("x")]
    #expect(SessionStack.members(of: "c", in: sessions).map(\.id) == ["a", "b", "c"])
    #expect(SessionStack.root(of: "c", in: sessions)?.id == "a")
    #expect(SessionStack.members(of: "x", in: sessions).isEmpty)
  }

  @Test("a child shown in another section from its parent starts there and names it")
  func splitAcrossSections() {
    let all = [session("a"), session("b", parent: "a"), session("c", parent: "b")]
    // `a` sits in Needs you; `b` and `c` are working.
    let working = SessionStack.place([all[2], all[1]], session: { (s: RemoteSession) -> RemoteSession? in s }, all: all)
    #expect(working.map(\.item.id) == ["b", "c"])
    #expect(working.map(\.depth) == [0, 1])
    #expect(working.first?.parentElsewhere?.id == "a")
    #expect(working.last?.parentElsewhere == nil)
    #expect(SessionStack.caption(parentElsewhere: working.first?.parentElsewhere) == "On top of a")
  }

  @Test("a compare run groups after stacks are placed, its slots one level under its header")
  func coexistsWithCompare() {
    let sessions = [
      session("c", parent: "a"), session("x1", compare: ("run", 0)), session("a"), session("x2", compare: ("run", 1)),
    ]
    let arranged = SessionStack.arrange(sessions, session: { (s: RemoteSession) -> RemoteSession? in s }, all: sessions)
    #expect(arranged.items.map(\.id) == ["x1", "a", "c", "x2"])
    #expect(arranged.nesting["c"]?.depth == 1)
    let items = CompareGroup.split(arranged.items).map(\.id)
    #expect(items == ["compare:run", "a", "c"])
  }
}
