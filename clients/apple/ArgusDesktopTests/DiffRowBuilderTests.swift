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

  private func diff(_ hunks: String...) -> DiffResult {
    DiffResult(
      filePath: "a.txt",
      hunks: hunks.enumerated().map { h, types in
        HunkData(id: "\(h)", header: "@@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: lines(types))
      },
      stats: DiffStats(additions: 0, deletions: 0))
  }

  @Test func inlineRowsAreEachHunksHeaderThenItsLines() {
    #expect(
      DiffRowBuilder.rows(for: diff(" -", "+"), layout: .inline) == [
        DiffRow(hunk: 0, kind: .header), DiffRow(hunk: 0, kind: .line(0)), DiffRow(hunk: 0, kind: .line(1)),
        DiffRow(hunk: 1, kind: .header), DiffRow(hunk: 1, kind: .line(0)),
      ])
  }

  @Test func splitRowsAreEachHunksHeaderThenItsPairs() {
    #expect(
      DiffRowBuilder.rows(for: diff(" -+", "-"), layout: .split) == [
        DiffRow(hunk: 0, kind: .header), DiffRow(hunk: 0, kind: .pair(left: 0, right: 0)),
        DiffRow(hunk: 0, kind: .pair(left: 1, right: 2)),
        DiffRow(hunk: 1, kind: .header), DiffRow(hunk: 1, kind: .pair(left: 0, right: nil)),
      ])
  }

  @Test func aDiffWithNoHunksHasNoRows() {
    #expect(DiffRowBuilder.rows(for: diff(), layout: .split).isEmpty)
    #expect(DiffRowBuilder.widestLine(in: diff()) == 0)
  }

  @Test func theWidestLineIsCountedAcrossHunks() {
    #expect(DiffRowBuilder.widestLine(in: diff("  ", String(repeating: " ", count: 11))) == "line 10".count)
  }

  @Test func onlyAdditionsOrOnlyDeletionsAreOneSided() {
    #expect(DiffRowBuilder.isOneSided(diff(" ++ ", "+")))
    #expect(DiffRowBuilder.isOneSided(diff("--", " - ")))
    #expect(!DiffRowBuilder.isOneSided(diff("+", "-")))
    #expect(!DiffRowBuilder.isOneSided(diff(" -+ ")))
  }

  private func numbered(old: Int?, new: Int?) -> DiffResult {
    let line = DiffLine(id: "0", type: old == nil ? .addition : .deletion, content: "x", oldLineNumber: old, newLineNumber: new)
    return DiffResult(
      filePath: "a.txt",
      hunks: [HunkData(id: "0", header: "@@", oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [line])],
      stats: DiffStats(additions: 0, deletions: 0))
  }

  @Test func aNewOrDeletedFileHasOneGutter() {
    #expect(DiffRowBuilder.gutters(for: numbered(old: nil, new: 1)) == .new)
    #expect(DiffRowBuilder.gutters(for: numbered(old: 1, new: nil)) == .old)
    #expect(DiffRowBuilder.gutters(for: numbered(old: 1, new: 1)) == .both)
  }
}
