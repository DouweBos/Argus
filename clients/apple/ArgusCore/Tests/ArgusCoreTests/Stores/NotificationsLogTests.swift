import ArgusCore
import Foundation
import Testing

@MainActor
@Suite("Notifications log")
struct NotificationsLogTests {
  final class Clock {
    var now = Date(timeIntervalSince1970: 1_000)
    func tick() { now += 1 }
  }

  @Test("a repeat collapses into the newest entry and doesn't count as new")
  func collapse() {
    let clock = Clock()
    let log = NotificationsLog { clock.now }
    log.push(.error, "offline", source: "agents")
    log.markSeen()
    clock.tick()
    log.push(.error, "offline", source: "agents")
    #expect(log.entries.count == 1)
    #expect(log.entries[0].count == 2)
    #expect(log.entries[0].timestamp == clock.now)
    #expect(log.unseenCount == 0)

    clock.tick()
    log.push(.warning, "offline", source: "agents")
    log.push(.error, "offline", source: "agents")
    #expect(log.entries.map(\.level) == [.error, .warning, .error])
    #expect(log.unseenCount == 2)
  }

  @Test("newest first, capped, and one can be dismissed")
  func capAndDismiss() {
    let clock = Clock()
    let log = NotificationsLog { clock.now }
    for index in 0..<(NotificationsLog.cap + 5) {
      clock.tick()
      log.push(.error, "e\(index)")
    }
    #expect(log.entries.count == NotificationsLog.cap)
    #expect(log.entries.first?.message == "e\(NotificationsLog.cap + 4)")

    let id = log.entries[0].id
    log.dismiss(id)
    #expect(!log.entries.contains { $0.id == id })

    log.clear()
    #expect(log.entries.isEmpty && log.unseenCount == 0)
  }
}
