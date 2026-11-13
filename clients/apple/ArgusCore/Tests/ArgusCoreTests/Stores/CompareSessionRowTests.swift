import ArgusCore
import ArgusKit
import Foundation
import Testing

@Suite("Compare session rows")
struct CompareSessionRowTests {
  private static func group(_ id: String, run: String? = nil, slot: Int = 0, listed: Bool = true) throws -> SessionGroup {
    let compare = run.map { #","compare_group":{"id":"\#($0)","slot":\#(slot)}"# } ?? ""
    let json = #"{"id":"\#(id)","kind":"worktree","branch":"b-\#(id)","repo_root":"/r","status":"ready"\#(compare)}"#
    let session = try JSONDecoder().decode(RemoteSession.self, from: Data(json.utf8))
    return SessionGroup(id: id, label: id, session: listed ? session : nil, agents: [])
  }

  @Test("folds a run's slots under one header, in slot order, keeping unlisted groups in place")
  func foldsRuns() throws {
    let rows = CompareSessionRow.make([
      try Self.group("a"), try Self.group("y", run: "g", slot: 1), try Self.group("u", listed: false),
      try Self.group("x", run: "g", slot: 0),
    ])
    #expect(rows.map(\.id) == ["a", "compare:g", "u"])
    guard case .compare(_, let slots) = rows[1] else {
      Issue.record("no run")
      return
    }
    #expect(slots.map(\.id) == ["x", "y"])
  }

  @Test("a run down to one slot is a plain row")
  func loneSlot() throws {
    #expect(CompareSessionRow.make([try Self.group("x", run: "g")]).map(\.id) == ["x"])
  }
}
