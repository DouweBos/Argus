import Testing

@testable import ArgusKit

@Suite("Agent names")
struct AgentNameTests {
  private func agent(_ id: String, title: String? = nil, created: Double, session: String = "s") -> RemoteAgentStatus {
    RemoteAgentStatus(agentId: id, sessionId: session, title: title, status: .idle, createdAt: created)
  }

  @Test("untitled siblings number by start time; the first stays plain")
  func numbersUntitled() {
    let first = agent("b", created: 1)
    let titled = agent("a", title: "Fix login", created: 2)
    let second = agent("c", created: 3)
    let tabs = [second, titled, first]
    #expect(tabs.map { Labels.agentName($0, among: tabs) } == ["New agent 2", "Fix login", "New agent"])
  }

  @Test("a lone untitled agent, or one in another session, is just \"New agent\"")
  func loneUntitled() {
    let mine = agent("a", created: 2)
    let elsewhere = agent("b", created: 1, session: "other")
    #expect(Labels.agentName(mine, among: [mine, elsewhere]) == "New agent")
    #expect(Labels.agentName(mine, among: []) == "New agent")
  }
}
