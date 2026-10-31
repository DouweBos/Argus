import Testing

@testable import ArgusUI

@Suite("Project activity line")
struct ProjectActivityLineTests {
  @Test("counts sessions, and agents only once there are any")
  func summary() {
    #expect(ProjectActivityLine.summary(agents: 0, sessions: 1) == "1 session")
    #expect(ProjectActivityLine.summary(agents: 1, sessions: 0) == "0 sessions · 1 agent")
    #expect(ProjectActivityLine.summary(agents: 3, sessions: 2) == "2 sessions · 3 agents")
  }

  @Test("no agents means no age")
  func lastActive() {
    #expect(ProjectActivityLine.lastActive([]) == nil)
  }
}
