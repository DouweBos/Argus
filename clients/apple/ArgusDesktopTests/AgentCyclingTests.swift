import Testing

@testable import Argus

struct AgentCyclingTests {
  @Test("⇧⌘] and ⇧⌘[ wrap around the session's agents")
  func wraps() {
    let ids = ["a", "b", "c"]
    #expect(DesktopModel.cycled(ids, from: "a", by: 1) == "b")
    #expect(DesktopModel.cycled(ids, from: "c", by: 1) == "a")
    #expect(DesktopModel.cycled(ids, from: "a", by: -1) == "c")
  }

  @Test("Nothing to switch to with one agent, or none in front")
  func nothingToCycle() {
    #expect(DesktopModel.cycled(["a"], from: "a", by: 1) == nil)
    #expect(DesktopModel.cycled(["a", "b"], from: nil, by: 1) == nil)
    #expect(DesktopModel.cycled(["a", "b"], from: "gone", by: 1) == nil)
  }
}
