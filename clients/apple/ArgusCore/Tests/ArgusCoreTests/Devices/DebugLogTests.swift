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
    log.append("boom", source: .stderr)
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
    log.append(#"{"status":"error","message":"x","timestamp":"t"}"#, source: .stdout)
    #expect(log.entries.first?.level == nil)
  }

  @Test("drops the oldest past the limit and filters by text")
  func capAndFilter() {
    var log = DebugLog(limit: 2)
    log.append("a\nb\nc", source: .stdout)
    #expect(log.entries.map(\.message) == ["b", "c"])
    #expect(log.entries.filter { $0.matches(" C ") }.map(\.message) == ["c"])
  }
}
