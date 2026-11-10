import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func decode<T: Decodable>(_ type: T.Type, _ json: [String: Any]) -> T {
  try! JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: json))
}

private func agent(_ id: String, status: String, awaiting: String? = nil, active: Double = 0) -> RemoteAgentStatus {
  var json: [String: Any] = [
    "agent_id": id, "session_id": "s-\(id)", "status": status, "title": "Agent \(id)", "last_activity_at": active,
  ]
  json["awaiting"] = awaiting
  return decode(RemoteAgentStatus.self, json)
}

private func proposal(_ id: String, status: String) -> RemoteProposal {
  decode(
    RemoteProposal.self,
    [
      "id": id, "automation_id": "a", "automation_name": "Nightly", "title": "Proposal \(id)", "summary": "",
      "rationale": "", "confidence": 0.8, "status": status, "created_at": 0,
    ])
}

@MainActor
@Suite("Widget snapshot from the stores")
struct WidgetSnapshotHostTests {
  @Test("keeps agents that need you or are running, waiting ones first, with links to their own computer")
  func agents() {
    let store = HostStore()
    store.recentAgents = [
      agent("run", status: "running", active: 3_000),
      agent("idle", status: "idle", active: 2_000),
      agent("wait", status: "running", awaiting: "permission", active: 1_000),
    ]
    let host = WidgetSnapshot.Host(host: store, proposals: [], id: "mac-1", name: "Studio")

    #expect(host.agents.map(\.id) == ["wait", "run"])
    #expect(host.agents.first?.attention == "needs approval")
    #expect(host.agents.first?.url.absoluteString == "argus://sessions/s-wait/agents/wait?host=mac-1&src=widget")
  }

  @Test("counts pending proposals only")
  func proposals() {
    let host = WidgetSnapshot.Host(
      host: HostStore(), proposals: [proposal("p1", status: "pending"), proposal("p2", status: "dismissed")],
      id: "mac-1", name: "Studio")

    #expect(host.proposalCount == 1)
    #expect(host.proposals.first?.url.absoluteString == "argus://inbox/proposals/p1?host=mac-1&src=widget")
  }

  @Test("takes the plan-wide five-hour and weekly windows")
  func usage() {
    let limits = ArgusProtocol.ClaudeUsageLimits(accounts: [
      .init(
        accountId: "1", label: "me@example.com", status: .ok, windows: [
          .init(id: "a", kind: .session, label: "Session", usedPercent: 47, resetsAt: 1_000_000),
          .init(id: "b", kind: .weekly, label: "Weekly · Opus", usedPercent: 80),
          .init(id: "c", kind: .weekly, label: "Weekly", usedPercent: 12),
        ], checkedAt: 0),
      .init(accountId: "2", label: "broken", status: .failed, windows: [], checkedAt: 0),
    ])
    let usage = WidgetSnapshot.Host.usage(limits)

    #expect(usage.count == 1)
    #expect(usage.first?.session?.usedPercent == 47)
    #expect(usage.first?.session?.resetsAt == Date(timeIntervalSince1970: 1_000))
    #expect(usage.first?.weekly?.usedPercent == 12)
  }
}
