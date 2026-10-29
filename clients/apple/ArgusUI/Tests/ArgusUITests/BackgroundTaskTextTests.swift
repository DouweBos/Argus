import ArgusCore
import Foundation
import Testing

@testable import ArgusUI

@Suite("Background task text")
struct BackgroundTaskTextTests {
  @Test("a running task reads its elapsed time live")
  func running() {
    let task = RemoteBackgroundTask(status: .running, startedAt: 1_000_000)
    let now = Date(timeIntervalSince1970: 1_000 + 252)
    #expect(BackgroundTaskText.label(task, now: now) == "Running · 4m 12s")
  }

  @Test("a settled task reads how long it took")
  func settled() {
    let now = Date()
    #expect(
      BackgroundTaskText.label(.init(status: .completed, startedAt: 0, durationMs: 1_121_000), now: now)
        == "Done in 18m 41s")
    #expect(BackgroundTaskText.label(.init(status: .failed, startedAt: 0, durationMs: 3_000), now: now) == "Failed after 3s")
    #expect(
      BackgroundTaskText.label(.init(status: .stopped, startedAt: 0, durationMs: 60_000), now: now)
        == "Stopped after 1m 0s")
  }
}
