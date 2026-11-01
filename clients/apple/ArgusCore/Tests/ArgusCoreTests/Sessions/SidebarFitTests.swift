import Testing

@testable import ArgusCore

@Suite("Sidebar fit")
struct SidebarFitTests {
  typealias State = SidebarFit.State

  @Test("cramped hides a shown sidebar, and room brings it back")
  func hidesAndReturns() {
    let hidden = SidebarFit.fit(State(shown: true, autoHidden: false), cramped: true)
    #expect(hidden == State(shown: false, autoHidden: true))
    #expect(SidebarFit.fit(hidden, cramped: false) == State(shown: true, autoHidden: false))
  }

  @Test("a sidebar the user hid stays hidden once there's room")
  func userHidden() {
    let state = State(shown: false, autoHidden: false)
    #expect(SidebarFit.fit(state, cramped: false) == state)
    #expect(SidebarFit.fit(state, cramped: true) == state)
  }

  @Test("an iPad 11-inch in portrait can't fit all three; landscape and 13-inch portrait can")
  func widths() {
    let cramped = { SidebarFit.panelCramped(width: $0, sidebar: 300, panel: 300, chat: 380) }
    #expect(cramped(834))
    #expect(!cramped(1210))
    #expect(!cramped(1032))
    #expect(!cramped(0))
  }
}
