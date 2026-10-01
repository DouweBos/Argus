import ArgusCore
import Testing

@Suite("Transcript chunks")
struct TranscriptChunksTests {
  private let ids = (0..<2000).map { "message-\($0)" }

  private func firstIds(_ ids: [String]) -> [String] {
    TranscriptChunks.ranges(ids).map { ids[$0.lowerBound] }
  }

  @Test("chunks cover every row once, in order, within the size cap")
  func coverage() {
    let ranges = TranscriptChunks.ranges(ids)
    #expect(ranges.first?.lowerBound == 0)
    #expect(ranges.last?.upperBound == ids.count)
    for (a, b) in zip(ranges, ranges.dropFirst()) { #expect(a.upperBound == b.lowerBound) }
    #expect(ranges.allSatisfy { !$0.isEmpty && $0.count <= TranscriptChunks.maxSize })
    // Small enough for a lazy stack, big enough to matter.
    #expect(ranges.count > 80 && ranges.count < 400)
  }

  @Test("an older page leaves the newer chunks' ids alone")
  func prependIsStable() {
    let later = Array(ids[800...])
    let before = Set(firstIds(later).dropFirst())
    let after = Set(firstIds(ids))
    #expect(before.isSubset(of: after))
  }

  @Test("appending only touches the last chunk")
  func appendIsStable() {
    let before = firstIds(Array(ids[..<1500]))
    let after = firstIds(ids)
    #expect(Array(after.prefix(before.count)) == before)
  }

  @Test("no rows, no chunks")
  func empty() {
    #expect(TranscriptChunks.ranges([]).isEmpty)
  }
}
