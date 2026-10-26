import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct CliProjectImportTests {
  private let now = Date(timeIntervalSince1970: 1_800_000_000)
  private let day = 86_400.0

  private func ms(ago seconds: Double) -> Double { (now.timeIntervalSince1970 - seconds) * 1000 }

  private func candidate(
    _ path: String, chats: Double = 5, agoDays: Double = 1, added: Bool = false
  ) -> ArgusProtocol.CliProjectCandidate {
    .init(path: path, name: path, chatCount: chats, lastActiveAt: ms(ago: agoDays * day), added: added)
  }

  @Test func shortAgeBucketsByLargestUnit() {
    #expect(CliProjectImport.shortAge(sinceMs: ms(ago: 10), now: now) == "now")
    #expect(CliProjectImport.shortAge(sinceMs: ms(ago: 60), now: now) == "1m")
    #expect(CliProjectImport.shortAge(sinceMs: ms(ago: 4 * 3600 + 300), now: now) == "4h")
    #expect(CliProjectImport.shortAge(sinceMs: ms(ago: 6 * day), now: now) == "6d")
    #expect(CliProjectImport.shortAge(sinceMs: ms(ago: 95 * day), now: now) == "3mo")
    #expect(CliProjectImport.shortAge(sinceMs: ms(ago: 800 * day), now: now) == "2y")
    #expect(CliProjectImport.shortAge(sinceMs: ms(ago: -300), now: now) == "now")
  }

  @Test func ticksBusyRecentNewProjectsOnly() {
    let picked = CliProjectImport.defaultSelection(
      [
        candidate("/busy"),
        candidate("/added", added: true),
        candidate("/quiet", chats: 2),
        candidate("/stale", agoDays: 31),
        candidate("/edge", chats: 3, agoDays: 30),
      ], now: now)
    #expect(picked == ["/busy", "/edge"])
  }

  @Test func pluralises() {
    #expect(CliProjectImport.chatCount(1) == "1 chat")
    #expect(CliProjectImport.chatCount(4) == "4 chats")
    #expect(CliProjectImport.importLabel(1) == "Import 1 project")
    #expect(CliProjectImport.importLabel(0) == "Import 0 projects")
  }
}
