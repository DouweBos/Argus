import Testing

@testable import ArgusCore

struct SessionTimelineTests {
  private let turns = [
    TimelineTurn(number: 1, checkpointId: "a", agentId: "x", prompt: "First", timestamp: 1, available: false),
    TimelineTurn(number: 2, checkpointId: "b", agentId: "x", prompt: "Second", timestamp: 2),
    TimelineTurn(number: 3, checkpointId: "c", agentId: "x", prompt: "Third", timestamp: 4, finished: false),
  ]

  @Test func listsNewestFirstWithRestoresBetweenTurns() {
    let restore = TimelineRestore(id: "r", checkpointId: "b", turnNumber: 2, timestamp: 3, canUndo: true)
    let timeline = SessionTimeline(turns: turns, restores: [restore])
    #expect(timeline.entries.map(\.id) == ["turn:c", "restore:r", "turn:b", "turn:a"])
    #expect(timeline.undoable == restore)
  }

  @Test func picksTheRoutedTurnElseTheNewestThatCanBeDiffed() {
    let timeline = SessionTimeline(turns: turns)
    #expect(timeline.turn("b")?.number == 2)
    #expect(timeline.turn(nil)?.number == 3)
    #expect(timeline.turn("gone")?.number == 3)
  }

  @Test func onlyAFinishedTurnWithItsCheckpointCanBeRestored() {
    #expect(turns.map(\.canRestore) == [false, true, false])
  }
}
