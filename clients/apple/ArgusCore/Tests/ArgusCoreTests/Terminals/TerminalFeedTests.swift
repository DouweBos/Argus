import ArgusCore
import Foundation
import Testing

struct TerminalFeedTests {
  private func bytes(_ text: String) -> Data { Data(text.utf8) }

  @Test func holdsLiveOutputUntilTheReplayLands() {
    var feed = TerminalFeed()
    feed.beginReplay()
    #expect(feed.live(.data(bytes("a")), seq: 4).isEmpty)
    #expect(feed.live(.data(bytes("b")), seq: 6).isEmpty)

    // `a` was sent before the replay's response, so the replay already has it.
    let out = feed.replay(data: bytes("history a"), exitCode: nil, seq: 5)
    #expect(out == [.reset, .data(bytes("history a")), .data(bytes("b"))])
  }

  @Test func dropsEventsDeliveredLateButSentBeforeTheReplay() {
    var feed = TerminalFeed()
    feed.beginReplay()
    _ = feed.replay(data: bytes("x"), exitCode: nil, seq: 10)
    #expect(feed.live(.data(bytes("old")), seq: 9).isEmpty)
    #expect(feed.live(.data(bytes("new")), seq: 11) == [.data(bytes("new"))])
  }

  @Test func anExitedTerminalReplaysItsExit() {
    var feed = TerminalFeed()
    feed.beginReplay()
    #expect(feed.replay(data: Data(), exitCode: 2, seq: 1) == [.reset, .exit(2)])
  }
}
