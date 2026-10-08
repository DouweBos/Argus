import Foundation
import Testing

@testable import ArgusCore

@Suite("Line diff")
struct LineDiffTests {
  let base = "a\nb\nc\nd\ne\n"

  @Test("an unchanged text has no marks")
  func unchanged() {
    #expect(LineDiff.marks(base: base, current: base).isEmpty)
  }

  @Test("added, modified and deleted lines")
  func marks() {
    #expect(LineDiff.marks(base: base, current: "a\nb\nX\nY\nc\nd\ne\n") == [.added(2..<4)])
    #expect(LineDiff.marks(base: base, current: "a\nB\nc\nd\ne\n") == [.modified(1..<2)])
    #expect(LineDiff.marks(base: base, current: "a\nd\ne\n") == [.deleted(afterLine: 0)])
    #expect(LineDiff.marks(base: base, current: "b\nc\nd\ne\n") == [.deleted(afterLine: -1)])
    #expect(LineDiff.marks(base: base, current: "a\nB\nB2\nB3\nc\nd\ne\n") == [.modified(1..<2), .added(2..<4)])
    #expect(LineDiff.marks(base: base, current: "a\nX\nd\ne\n") == [.modified(1..<2), .deleted(afterLine: 1)])
  }

  @Test("lines map across an external reload")
  func mapping() {
    let new = "header\na\nb\nX\nd\ne\n"
    #expect(LineDiff.mapLine(0, from: base, to: new) == 1)
    #expect(LineDiff.mapLine(1, from: base, to: new) == 2)
    #expect(LineDiff.mapLine(2, from: base, to: new) == 3)  // c was replaced by X
    #expect(LineDiff.mapLine(4, from: base, to: new) == 5)
    #expect(LineDiff.mapLine(99, from: base, to: new) == 6)
    #expect(LineDiff.mapLine(3, from: base, to: "a\n") == 1)
  }

  @Test("changed lines are what to flash")
  func changed() {
    #expect(LineDiff.changedLines(from: base, to: "a\nB\nc\nd\nE\nF\n") == [1..<2, 4..<6])
    #expect(LineDiff.changedLines(from: base, to: "a\nc\nd\ne\n").isEmpty)
  }

  @Test("hunks pair removals with insertions")
  func hunks() {
    #expect(LineDiff.hunks(base: base, current: "a\nX\nY\nd\ne\n") == [.init(old: 1..<3, new: 1..<3)])
  }
}
