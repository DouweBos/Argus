import GroveKit
import Testing

@testable import Argus

@MainActor
struct DiffRowBuilderTests {
  private func lines(_ types: String) -> [DiffLine] {
    types.enumerated().map { i, c in
      let type: DiffLineType = c == "-" ? .deletion : c == "+" ? .addition : .context
      return DiffLine(id: "\(i)", type: type, content: "line \(i)")
    }
  }

  private func pairs(_ types: String) -> [[Int?]] {
    DiffRowBuilder.pairs(lines(types)).map { [$0.0, $0.1] }
  }

  @Test func contextSitsOnBothSides() {
    #expect(pairs("  ") == [[0, 0], [1, 1]])
  }

  @Test func deletionsPairWithTheAdditionsAfterThem() {
    #expect(pairs(" --++ ") == [[0, 0], [1, 3], [2, 4], [5, 5]])
  }

  @Test func theLongerRunLeavesBlanksOpposite() {
    #expect(pairs("---+") == [[0, 3], [1, nil], [2, nil]])
    #expect(pairs("-+++") == [[0, 1], [nil, 2], [nil, 3]])
  }

  @Test func additionsAloneHaveNoLeftSide() {
    #expect(pairs("++") == [[nil, 0], [nil, 1]])
  }

  @Test func additionsBeforeDeletionsArePairedSeparately() {
    #expect(pairs("+-") == [[nil, 0], [1, nil]])
  }

  @Test func emptyHunksHaveNoPairs() {
    #expect(pairs("").isEmpty)
  }
}
