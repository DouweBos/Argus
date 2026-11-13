import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Compare runs")
struct CompareRunTests {
  private static func session(_ id: String, group: String? = nil, slot: Int = 0) -> String {
    let compare = group.map { #","compare_group":{"id":"\#($0)","slot":\#(slot),"runner_id":"codex"}"# } ?? ""
    return #"{"id":"\#(id)","kind":"worktree","branch":"b-\#(id)","repo_root":"/r","status":"ready"\#(compare)}"#
  }

  private static func sessions(_ json: [String]) throws -> [RemoteSession] {
    try JSONDecoder().decode([RemoteSession].self, from: Data("[\(json.joined(separator: ","))]".utf8))
  }

  @Test("groups a run's slots in slot order where its first slot sits")
  func splitsGroups() throws {
    let list = try Self.sessions([
      Self.session("a"), Self.session("y", group: "g", slot: 1), Self.session("b"),
      Self.session("x", group: "g", slot: 0),
    ])
    let items = CompareGroup.split(list)
    #expect(items.map(\.id) == ["a", "compare:g", "b"])
    guard case .group(let group) = items[1] else {
      Issue.record("no group")
      return
    }
    #expect(group.sessions.map(\.id) == ["x", "y"])
  }

  @Test("a run down to one slot reads as a plain session")
  func loneSlotIsPlain() throws {
    let items = CompareGroup.split(try Self.sessions([Self.session("x", group: "g")]))
    #expect(items.map(\.id) == ["x"])
  }

  @Test("the worst run decides the summary")
  func runSummary() {
    let run = { (s: CompareRunState) in CompareRunCommand(title: "t", state: s, isTest: true) }
    #expect(CompareSlotScore.summary([]) == nil)
    #expect(CompareSlotScore.summary([run(.passed), run(.running)]) == .running)
    #expect(CompareSlotScore.summary([run(.running), run(.failed)]) == .failed)
    #expect(CompareSlotScore.summary([run(.passed)]) == .passed)
  }

  @Test("a start with slots asks for one compare run, defaults only on the default runner")
  func startsCompare() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply(
      "sessions.create_compare",
      #"{"group_id":"g","sessions":[\#(Self.session("x", group: "g")),\#(Self.session("y", group: "g", slot: 1))]}"#)
    backend.reply("sessions.list", #"{"sessions":[]}"#)
    let store = HostStore()
    await store.attach(backend)
    let request = ComposerStart(
      message: "fix it", displayText: "fix it",
      compareSlots: [CompareSlot(), CompareSlot(runnerId: "codex", model: "gpt-5")])

    let first = await store.startInNewWorktree(
      repoRoot: "/r", baseBranch: "main", request: request,
      defaults: AgentStartDefaults(model: "opus", effort: "high"))

    #expect(first?.id == "x")
    #expect(backend.calls("sessions.create").isEmpty)
    let params = backend.calls("sessions.create_compare").first?.params
    #expect(params?["prompt"] == .string("fix it"))
    let slots = params?["slots"]?.arrayValue ?? []
    #expect(slots.count == 2)
    #expect(slots.first?["model"] == .string("opus"))
    #expect(slots.last?["model"] == .string("gpt-5"))
    #expect(slots.last?["effort"] == nil || slots.last?["effort"] == .null)
  }

  @Test("keeping decodes what the computer did")
  func keeps() async {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("sessions.keep_compare", #"{"pull_request_url":"https://x/pull/1","deleted":2}"#)
    backend.reply("sessions.list", #"{"sessions":[\#(Self.session("x", group: "g"))]}"#)
    backend.reply("agents.list", #"{"agents":[]}"#)
    let store = HostStore()
    await store.attach(backend)
    await store.loadSessions(repoRoot: "/r")

    let kept = await store.keepCompare(sessionId: "x", land: .pullRequest, deleteOthers: true)

    #expect(kept?.pullRequestUrl == "https://x/pull/1")
    #expect(kept?.deleted == 2)
    let params = backend.calls("sessions.keep_compare").first?.params
    #expect(params?["land"] == .string("pull_request"))
    #expect(params?["delete_others"] == .bool(true))
  }
}
