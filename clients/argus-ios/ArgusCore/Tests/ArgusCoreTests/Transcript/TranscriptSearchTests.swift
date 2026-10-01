import ArgusCore
import Foundation
import Testing

@Suite("Transcript search")
struct TranscriptSearchTests {
  private let units = [
    TranscriptSearch.Unit(id: "m1", text: "Build the App, then the app tests"),
    TranscriptSearch.Unit(id: "m2#tool#t1", text: "Read src/App.swift"),
    TranscriptSearch.Unit(id: "m3", text: "aaaa"),
  ]

  @Test("matches are case-insensitive, trimmed and in transcript order")
  func caseInsensitive() {
    let hits = TranscriptSearch.find("  app ", in: units)
    #expect(hits.map(\.unitId) == ["m1", "m1", "m2#tool#t1"])
    #expect(hits.map(\.range) == [NSRange(location: 10, length: 3), NSRange(location: 24, length: 3), NSRange(location: 9, length: 3)])
  }

  @Test("matches never overlap")
  func nonOverlapping() {
    #expect(TranscriptSearch.find("aa", in: units).map(\.range.location) == [0, 2])
  }

  @Test("an empty query finds nothing")
  func emptyQuery() {
    #expect(TranscriptSearch.find("   ", in: units).isEmpty)
  }

  @Test("stepping wraps both ways and starts at the right end")
  func stepping() {
    #expect(TranscriptSearch.step(from: nil, count: 3, forward: true) == 0)
    #expect(TranscriptSearch.step(from: nil, count: 3, forward: false) == 2)
    #expect(TranscriptSearch.step(from: 2, count: 3, forward: true) == 0)
    #expect(TranscriptSearch.step(from: 0, count: 3, forward: false) == 2)
    #expect(TranscriptSearch.step(from: 0, count: 0, forward: true) == nil)
  }

  @Test("the counter reads like the desktop's")
  func counter() {
    #expect(TranscriptSearch.counter(query: "", count: 0, current: nil) == "")
    #expect(TranscriptSearch.counter(query: "x", count: 0, current: nil) == "No matches")
    #expect(TranscriptSearch.counter(query: "x", count: 12, current: 2) == "3 of 12")
  }
}
