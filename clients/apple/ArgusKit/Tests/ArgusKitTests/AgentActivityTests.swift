import Foundation
import Testing
@testable import ArgusKit

/// Live Activity updates sealed by the host's `sealJson`. The widget extension
/// opens these on the Lock Screen; a mismatch leaves the card on its phase alone.
@Suite("Agent Live Activity state")
struct AgentActivityTests {
  private static let pushKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
  private static let sealed = """
    AwMDAwMDAwMDAwMDXtzCZD9GKjFYehgnyT6bLtcegYjR++BdHvyrk5CAM8vYyBNr/9mfYr3tOHag/8VpBVB6sOXnH00ObkfbHkDnD56NGVSN1gZ+\
    I4PU8/at5lKPzbwGKE9sXpgwoLJROgNsoKdU1PUMVWlQ71V9C5Fpwf7UHU1FpfA5mavXqF18LtCLhcHkRHmFQuFAZ8VZZO4Cv0e1vKf2yCM20zuU\
    qizl7wlB+y0uCfAEfeWGwB7ylloFnpSxW6cYudGC2uGTY8JVFWjoyWoeNTfjbGw68J1AvXBoE7b8mwpPlwbSLUdN9p3JN6WcWee+6PqTWNUnC/Eu\
    rcOl54wJJGuYTu4LqkKGfJY=
    """

  @Test("opens a snapshot sealed by the host")
  func opensHostSnapshot() throws {
    let snapshot = try #require(AgentActivityState.open(Self.sealed, pushKey: Self.pushKey))
    #expect(snapshot.more == 2)
    let agent = try #require(snapshot.agents.first)
    #expect(agent.id == "agent-1")
    #expect(agent.sessionId == "sess-1")
    #expect(agent.state == .needsYou)
    #expect(agent.started == Date(timeIntervalSince1970: 1_700_000_000))
    #expect(agent.ended == nil)
    #expect(agent.prompt == .init(toolUseId: "tu-1", summary: "Bash rm -rf build"))
  }

  @Test("keeps the phase when the sealed half can't be opened")
  func fallsBackToPhase() throws {
    let json = #"{"p":"failed","e":"bm90IG91cnM=","t":1700000000000}"#
    let state = try JSONDecoder().decode(AgentActivityState.self, from: Data(json.utf8))
    #expect(state.phase == .failed)
    #expect(state.snapshot == nil)
  }

  @Test("round-trips the app's own state in the clear")
  func roundTripsLocalState() throws {
    let snapshot = AgentActivitySnapshot(agents: [
      .init(
        id: "a", sessionId: "s", title: "Agent", project: nil, state: .working,
        startedAt: Date(timeIntervalSince1970: 1_000))
    ])
    let state = AgentActivityState(snapshot: snapshot, updatedAt: Date(timeIntervalSince1970: 2_000))
    let decoded = try JSONDecoder().decode(AgentActivityState.self, from: JSONEncoder().encode(state))
    #expect(decoded == state)
    #expect(!snapshot.isSettled)
  }

  @Test("an unknown phase reads as working")
  func unknownPhase() throws {
    let state = try JSONDecoder().decode(AgentActivityState.self, from: Data(#"{"p":"new","t":0}"#.utf8))
    #expect(state.phase == .working)
  }
}
