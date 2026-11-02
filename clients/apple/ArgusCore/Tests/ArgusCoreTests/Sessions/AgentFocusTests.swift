import Testing

@testable import ArgusCore

@Suite("Agent focus")
struct AgentFocusTests {
  @Test("opening an agent puts it in front over the tab its session last showed")
  func requestBeatsStalePick() {
    var focus = AgentFocus()
    focus.pick("a1", sessionId: "s1", agentId: nil)
    focus.request(agentId: "a2", sessionId: "s1")
    #expect(focus.front(sessionId: "s1", agentId: "a2") == "a2")
    #expect(focus[session: "s1"] == "a2")
  }

  @Test("a request made before the session is known still wins once it is")
  func requestBeforeSessionKnown() {
    var focus = AgentFocus()
    focus.pick("a1", sessionId: "s1", agentId: nil)
    focus.request(agentId: "a2", sessionId: nil)
    #expect(focus.front(sessionId: nil, agentId: "a2") == "a2")
    #expect(focus.front(sessionId: "s1", agentId: "a2") == "a2")
    // Filed under the session once it resolves, so the side panel agrees.
    focus.pick("a2", sessionId: "s1", agentId: "a2")
    #expect(focus.byKey == ["s1": "a2"])
  }

  @Test("a tab picked afterwards wins over the agent the screen opened on")
  func pickAfterRequest() {
    var focus = AgentFocus()
    focus.request(agentId: "a2", sessionId: nil)
    focus.pick("a3", sessionId: "s1", agentId: "a2")
    #expect(focus.front(sessionId: "s1", agentId: "a2") == "a3")
  }

  @Test("a session opened without an agent keeps the tab it last showed")
  func sessionKeepsPick() {
    var focus = AgentFocus()
    focus.pick("a1", sessionId: "s1", agentId: nil)
    #expect(focus.front(sessionId: "s1", agentId: nil) == "a1")
    #expect(focus.front(sessionId: "s2", agentId: nil) == nil)
  }

  @Test("only the routes past the shared prefix count as opened")
  func opened() {
    #expect(Array(AgentFocus.opened(from: [1, 2], to: [1, 2, 3])) == [3])
    #expect(Array(AgentFocus.opened(from: [1, 2, 3], to: [1, 2])).isEmpty)
    #expect(Array(AgentFocus.opened(from: [1, 2], to: [1, 4])) == [4])
    #expect(Array(AgentFocus.opened(from: [], to: [5])) == [5])
    #expect(Array(AgentFocus.opened(from: [1], to: [1])).isEmpty)
  }
}
