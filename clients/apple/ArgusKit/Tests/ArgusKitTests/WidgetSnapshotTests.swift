import Foundation
import Testing

@testable import ArgusKit

struct WidgetSnapshotTests {
  private func agent(_ id: String, attention: String? = nil, at seconds: Double = 0) -> WidgetSnapshot.Agent {
    .init(
      id: id, title: id, project: nil, attention: attention, activityAt: Date(timeIntervalSince1970: seconds),
      url: URL(string: "argus://agents")!)
  }

  private func host(_ id: String, agents: [WidgetSnapshot.Agent] = [], proposals: Int = 0, usage: [String] = [], at seconds: Double = 0)
    -> WidgetSnapshot.Host
  {
    .init(
      id: id, name: id, updatedAt: Date(timeIntervalSince1970: seconds), agents: agents, proposals: [],
      proposalCount: proposals,
      usage: usage.map { .init(label: $0, session: .init(usedPercent: seconds, resetsAt: nil), weekly: nil) })
  }

  @Test func countsAcrossComputersWithWaitingAgentsFirst() {
    var snapshot = WidgetSnapshot()
    snapshot.upsert(host("a", agents: [agent("run1", at: 9), agent("wait1", attention: "needs approval", at: 1)], proposals: 2), paired: ["a", "b"])
    snapshot.upsert(host("b", agents: [agent("wait2", attention: "review plan", at: 5)], proposals: 1), paired: ["a", "b"])

    #expect(snapshot.needsYouCount == 2)
    #expect(snapshot.runningCount == 1)
    #expect(snapshot.proposalCount == 3)
    #expect(snapshot.agents.map(\.agent.id) == ["wait2", "wait1", "run1"])
  }

  @Test func upsertReplacesItsComputerAndDropsUnpairedOnes() {
    var snapshot = WidgetSnapshot()
    snapshot.upsert(host("a", proposals: 1), paired: ["a", "b"])
    snapshot.upsert(host("b"), paired: ["a", "b"])
    snapshot.upsert(host("a", proposals: 4), paired: ["a"])

    #expect(snapshot.hosts.map(\.id) == ["a"])
    #expect(snapshot.proposalCount == 4)
  }

  @Test func usageReadsEachAccountOnceFromTheNewestComputer() {
    var snapshot = WidgetSnapshot()
    snapshot.upsert(host("a", usage: ["me@x"], at: 10), paired: ["a", "b"])
    snapshot.upsert(host("b", usage: ["me@x", "work@x"], at: 20), paired: ["a", "b"])

    #expect(snapshot.usage.map(\.label) == ["me@x", "work@x"])
    #expect(snapshot.usage.first?.session?.usedPercent == 20)
  }

  @Test func pushesFlagAndClearAgents() {
    var snapshot = WidgetSnapshot()
    snapshot.upsert(host("a", agents: [agent("x"), agent("y")]), paired: ["a"])

    let flagged = snapshot.apply(pushKind: "permission", agentId: "x")
    #expect(flagged && snapshot.needsYouCount == 1)
    let finished = snapshot.apply(pushKind: "finished", agentId: "y")
    #expect(finished && snapshot.agents.map(\.agent.id) == ["x"])
    let unknown = snapshot.apply(pushKind: "permission", agentId: "unknown")
    let plain = snapshot.apply(pushKind: "push", agentId: "x")
    #expect(!unknown && !plain)
  }

  @Test func storeRoundTripsThroughTheAppGroup() {
    let suite = "WidgetSnapshotTests.\(UUID())"
    defer { UserDefaults().removePersistentDomain(forName: suite) }
    WidgetSnapshotStore.update(appGroup: suite) { $0.upsert(host("a", proposals: 2), paired: ["a"]) }

    #expect(WidgetSnapshotStore.load(appGroup: suite).proposalCount == 2)
    #expect(!WidgetSnapshotStore.update(appGroup: suite) { _ in })
  }

  @Test func linksAreTaggedWithTheirSource() {
    let url = WidgetLink.url(path: "/sessions/s1/agents/a1?host=h1")
    #expect(url.absoluteString == "argus://sessions/s1/agents/a1?host=h1&src=widget")
    #expect(WidgetLink.source(of: url) == .widget)
    #expect(WidgetLink.source(of: URL(string: "argus://inbox")!) == nil)

    let newAgent = WidgetLink.url(path: WidgetLink.newAgentPath, source: .control)
    #expect(WidgetLink.isNewAgent(newAgent))
    #expect(WidgetLink.source(of: newAgent) == .control)
    #expect(!WidgetLink.isNewAgent(URL(string: "argus://sessions/abc")!))
  }
}
