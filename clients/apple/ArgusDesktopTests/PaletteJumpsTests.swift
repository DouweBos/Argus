import ArgusCore
import Foundation
import Testing

@testable import Argus

@Suite("Palette jumps")
struct PaletteJumpsTests {
  typealias Jumps = PaletteJumps
  private let places = [
    Jumps.Place(sessionId: "a", name: "Onboarding", project: "Argus"),
    Jumps.Place(sessionId: "b", name: "main", project: "luma"),
  ]

  @Test("chats are titled by the chat, subtitled session · project, newest first")
  func chatsByRecency() {
    let jumps = Jumps.chats(
      places,
      live: [
        "a": [.init(agentId: "a1", title: "Old chat", lastActive: 100, runnerSessionId: nil)],
        "b": [.init(agentId: "b1", title: "New chat", lastActive: 300, runnerSessionId: nil)],
      ],
      saved: ["a": [.init(historyId: "h1", title: "Saved chat", endedAt: 200, runnerSessionId: "r1")]],
      current: nil)
    #expect(jumps.map(\.title) == ["New chat", "Saved chat", "Old chat"])
    #expect(jumps[0].subtitle == "main · luma")
    #expect(jumps[1].target == .savedChat(sessionId: "a", historyId: "h1"))
    #expect(Set(jumps.map(\.section)) == [Jumps.chatsSection])
  }

  @Test("a saved chat already resumed into a live agent isn't listed twice")
  func resumedChatOnce() {
    let jumps = Jumps.chats(
      places, live: ["a": [.init(agentId: "a1", title: "Chat", lastActive: 300, runnerSessionId: "r1")]],
      saved: ["a": [.init(historyId: "h1", title: "Chat", endedAt: 200, runnerSessionId: "r1")]], current: nil)
    #expect(jumps.map(\.target) == [.agent(sessionId: "a", agentId: "a1")])
  }

  @Test("the current session's items rank first, each side keeping its order")
  func currentSessionFirst() {
    let chats = Jumps.chats(
      places,
      live: [
        "a": [.init(agentId: "a1", title: "A", lastActive: 100, runnerSessionId: nil)],
        "b": [
          .init(agentId: "b1", title: "B1", lastActive: 300, runnerSessionId: nil),
          .init(agentId: "b2", title: "B2", lastActive: 200, runnerSessionId: nil),
        ],
      ], saved: [:], current: "a")
    #expect(chats.map(\.title) == ["A", "B1", "B2"])
    let terminals = Jumps.terminals(
      places,
      tabs: ["a": [.init(id: "t1", title: "zsh", isRun: false)], "b": [.init(id: "t2", title: "Storybook", isRun: true)]],
      current: "b")
    #expect(terminals.map(\.target) == [
      .terminal(sessionId: "b", terminalId: "t2"), .terminal(sessionId: "a", terminalId: "t1"),
    ])
    #expect(terminals[0].systemImage != terminals[1].systemImage)
  }

  @Test("editor tabs list the latest opened first, named by file with the folder in the subtitle")
  func files() {
    let jumps = Jumps.files(places, tabs: ["a": ["README.md", "src/app/main.ts"]], current: nil)
    #expect(jumps.map(\.title) == ["main.ts", "README.md"])
    #expect(jumps[0].subtitle == "src/app · Onboarding · Argus")
    #expect(jumps[1].subtitle == "Onboarding · Argus")
    #expect(jumps[0].keywords == ["src/app/main.ts"])
    #expect(jumps[0].target == .file(sessionId: "a", path: "src/app/main.ts"))
  }

  @Test("an empty query caps each jump section; typing lifts the cap")
  func capping() {
    let items = (0..<8).map { (Jumps.chatsSection, $0) } + (0..<8).map { ("Sessions", $0) }
    let empty = Jumps.capped(items, query: " ") { $0.0 }
    #expect(empty.filter { $0.0 == Jumps.chatsSection }.count == Jumps.emptyQueryCap)
    #expect(empty.filter { $0.0 == "Sessions" }.count == 8)
    #expect(Jumps.capped(items, query: "x") { $0.0 }.count == 16)
  }

  @Test("jumps match through the palette's fuzzy ranking by title, file path or subtitle")
  func matching() {
    let jumps = Jumps.files(places, tabs: ["a": ["src/app/main.ts"]], current: nil)
      + Jumps.chats(
        places, live: ["b": [.init(agentId: "b1", title: "Fix the Android build", lastActive: 1, runnerSessionId: nil)]],
        saved: [:], current: nil)
    let texts: (Jumps.Jump) -> [String] = { [$0.title, $0.subtitle] + $0.keywords }
    #expect(PaletteMatch.rank(jumps, query: "android", texts: texts).map(\.id) == ["chat.agent.b1"])
    #expect(PaletteMatch.rank(jumps, query: "app/main", texts: texts).first?.title == "main.ts")
    #expect(PaletteMatch.rank(jumps, query: "luma", texts: texts).first?.id == "chat.agent.b1")
  }
}
