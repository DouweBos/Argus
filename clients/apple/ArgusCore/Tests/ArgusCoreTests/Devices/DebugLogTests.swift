import ArgusCore
import Testing

@Suite("Device debug log")
struct DebugLogTests {
  @Test("parses structured stdout lines and keeps the rest as text")
  func parses() {
    var log = DebugLog()
    log.append(
      #"{"level":"warn","message":"low memory","timestamp":"10:00","source":"device"}"# + "\nplain\n",
      source: .stdout)
    log.append("boom\n", source: .stderr)
    #expect(log.entries.map(\.message) == ["low memory", "plain", "boom"])
    #expect(log.entries[0].level == .warning)
    #expect(log.entries[0].origin == "device")
    #expect(log.entries[1].level == nil)
    #expect(log.entries.map(\.isError) == [true, false, true])
    #expect(log.entries.map(\.id) == [1, 2, 3])
  }

  @Test("a status error line is text, not an entry")
  func statusError() {
    var log = DebugLog()
    log.append(#"{"status":"error","message":"x","timestamp":"t"}"# + "\n", source: .stdout)
    #expect(log.entries.first?.level == nil)
  }

  @Test("drops the oldest past the limit and filters by text")
  func capAndFilter() {
    var log = DebugLog(limit: 2)
    log.append("a\nb\nc\n", source: .stdout)
    #expect(log.entries.map(\.message) == ["b", "c"])
    #expect(log.entries.filter { $0.matches(" C ") }.map(\.message) == ["c"])
  }

  @Test("a line split across chunks is parsed once it is whole")
  func splitLine() {
    var log = DebugLog()
    log.append(#"{"level":"error","message":"half"#, source: .stdout)
    #expect(log.entries.isEmpty)
    log.append(#"way","timestamp":"t"}"# + "\nnext\n", source: .stdout)
    #expect(log.entries.map(\.message) == ["halfway", "next"])
    #expect(log.entries.first?.level == .error)
  }

  @Test("the clock time drops the date, zone and sub-millisecond digits")
  func clockTime() {
    var log = DebugLog()
    log.append(#"{"level":"log","message":"a","timestamp":"2026-10-04 21:04:54.120707+0200"}"# + "\n", source: .stdout)
    log.append(#"{"level":"log","message":"b","timestamp":"10:00"}"# + "\n", source: .stdout)
    #expect(log.entries.map(\.clockTime) == ["21:04:54.120", "10:00"])
  }
}
