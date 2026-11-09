import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func agent(_ id: String, runner: String?) -> RemoteAgentStatus {
  var json: [String: Any] = ["agent_id": id, "session_id": "s1", "status": "idle", "created_at": 0]
  json["runner_id"] = runner
  return try! JSONDecoder().decode(RemoteAgentStatus.self, from: JSONSerialization.data(withJSONObject: json))
}

/// Rewind, fork and side questions are hidden for agents whose runner can't do them.
@MainActor
@Suite("Runner capabilities")
struct RunnerCapabilitiesTests {
  @Test("an agent's runner flags gate rewind/fork and side questions; unknown means able")
  func perAgent() async {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(
      .automationsRunners,
      #"{"runners":[{"id":"claude-code","display_name":"Claude Code","is_custom":false,"models":[],"supports_transcript_fork":true,"supports_side_question":true},{"id":"codex","display_name":"Codex","is_custom":false,"models":[],"supports_transcript_fork":false,"supports_side_question":false},{"id":"old","display_name":"Old","is_custom":false,"models":[]}]}"#
    )
    await store.attach(backend)
    await store.loadRunners()
    store.statusByAgent["claude"] = agent("claude", runner: nil)
    store.statusByAgent["codex"] = agent("codex", runner: "codex")
    store.statusByAgent["old"] = agent("old", runner: "old")
    store.statusByAgent["gone"] = agent("gone", runner: "removed")

    #expect(store.supportsTranscriptFork(agentId: "claude"))
    #expect(store.supportsSideQuestion(agentId: "claude"))
    #expect(!store.supportsTranscriptFork(agentId: "codex"))
    #expect(!store.supportsSideQuestion(agentId: "codex"))
    #expect(store.supportsTranscriptFork(agentId: "old"))
    #expect(store.supportsSideQuestion(agentId: "old"))
    #expect(store.supportsTranscriptFork(agentId: "gone"))
    #expect(store.supportsTranscriptFork(agentId: "unknown-agent"))
  }

  @Test("a runner whose cli is missing decodes unavailable with its install hint; older hosts mean available")
  func availability() throws {
    let json = #"""
      [{"id":"gemini","display_name":"Gemini CLI","is_custom":false,"models":[],"available":false,"unavailable_reason":"Install gemini"},
       {"id":"old","display_name":"Old","is_custom":false,"models":[]},
       {"id":"custom:x","display_name":"X","is_custom":true,"models":[],"available":true}]
      """#
    let runners = try JSONDecoder().decode([RemoteRunner].self, from: Data(json.utf8))
    #expect(!runners[0].isAvailable)
    #expect(runners[0].pickerHint == "Install gemini")
    #expect(runners[1].isAvailable)
    #expect(runners[1].pickerHint == nil)
    #expect(runners[2].pickerHint == "Custom")
  }
}
