import Testing

@testable import ArgusCore

struct SessionDiffScopeTests {
  private let turns = [
    SessionTurn(number: 1, checkpointId: "a", agentId: "x", prompt: "First", timestamp: 1),
    SessionTurn(number: 2, checkpointId: "b", agentId: "x", prompt: "Second", timestamp: 2),
  ]

  @Test func readsItsModeBack() {
    for scope in [SessionDiffScope.uncommitted, .branch, .lastTurn, .turn(turns[0])] {
      #expect(SessionDiffScope(mode: scope.mode, turns: turns) == scope)
    }
  }

  @Test func aTurnThatsGoneReadsAsTheLastTurn() {
    #expect(SessionDiffScope(mode: "turn:gone", turns: turns) == .lastTurn)
  }

  @Test func wiresAPinnedTurnAsItsCheckpoint() {
    #expect(SessionDiffScope.wire(mode: "turn:b") == ("turn", "b"))
    #expect(SessionDiffScope.wire(mode: "working") == ("working", nil))
  }

  @Test func reviewCommentsNameTheTurnByNumber() {
    #expect(SessionDiffScope.lastTurn.reviewScope(in: turns) == "changes from turn 2")
    #expect(SessionDiffScope.turn(turns[0]).reviewScope(in: turns) == "changes from turn 1")
  }
}
