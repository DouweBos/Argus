import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@Suite("Line blame")
struct LineBlameTests {
  let base = "a\nb\nc\nd\ne\n"
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let english = Locale(identifier: "en_US")

  private func chunk(_ sha: String, start: Int, count: Int, daysAgo: Double = 3) -> ArgusProtocol.BlameChunk {
    .init(
      author: "Ada \(sha)", authorEmail: "ada@example.com",
      authorTime: (now.timeIntervalSince1970 - daysAgo * 86_400) * 1000, commitHash: sha, lineCount: Double(count),
      lineStart: Double(start), summary: "change \(sha)")
  }

  private var index: BlameIndex {
    BlameIndex(chunks: [chunk("c2", start: 3, count: 3), chunk("c1", start: 1, count: 2)])
  }

  @Test("an untouched buffer maps every line to itself")
  func unchanged() {
    #expect(LineBlame.baseLine(for: 3, hunks: []) == 3)
  }

  @Test("lines below an insertion or deletion shift back to their HEAD line")
  func shifted() {
    let inserted = LineDiff.hunks(base: base, current: "a\nX\nY\nb\nc\nd\ne\n")
    #expect(LineBlame.baseLine(for: 0, hunks: inserted) == 0)
    #expect(LineBlame.baseLine(for: 1, hunks: inserted) == nil)
    #expect(LineBlame.baseLine(for: 3, hunks: inserted) == 1)
    let deleted = LineDiff.hunks(base: base, current: "a\nd\ne\n")
    #expect(LineBlame.baseLine(for: 1, hunks: deleted) == 3)
  }

  @Test("an edited line isn't committed; the rest come from HEAD's blame")
  func lookup() {
    let hunks = LineDiff.hunks(base: base, current: "a\nB\nc\nd\ne\n")
    #expect(LineBlame.of(line: 1, hunks: hunks, index: index) == .uncommitted)
    #expect(LineBlame.of(line: 1, hunks: hunks, index: nil) == .uncommitted)
    guard case .committed(let first) = LineBlame.of(line: 0, hunks: hunks, index: index) else {
      Issue.record("line 0 should be committed")
      return
    }
    #expect(first.sha == "c1")
    guard case .committed(let later) = LineBlame.of(line: 4, hunks: hunks, index: index) else {
      Issue.record("line 4 should be committed")
      return
    }
    #expect(later.sha == "c2")
    #expect(LineBlame.of(line: 2, hunks: hunks, index: nil) == nil)
    #expect(LineBlame.of(line: 9, hunks: [], index: index) == nil)
  }

  @Test("the label names the author, how long ago, and the summary")
  func label() {
    guard case .committed(let commit) = LineBlame.of(line: 0, hunks: [], index: index) else {
      Issue.record("line 0 should be committed")
      return
    }
    let blame = LineBlame.committed(commit)
    #expect(blame.byline(now: now, locale: english) == "Ada c1, 3 days ago")
    #expect(blame.label(now: now, locale: english) == "Ada c1, 3 days ago · change c1")
    #expect(LineBlame.uncommitted.label(now: now, locale: english) == "Not committed yet")
    let future = LineBlame.committed(.init(sha: "f", author: "Ada", date: now.addingTimeInterval(30), summary: ""))
    #expect(future.label(now: now, locale: english) == "Ada, now")
  }
}
