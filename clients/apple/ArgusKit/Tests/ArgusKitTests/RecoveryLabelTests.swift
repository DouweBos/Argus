import Foundation
import Testing

@testable import ArgusKit

@Suite("Teammate failure and upcoming labels")
struct RecoveryLabelTests {
  private let now = Date()
  private var nowMs: Double { now.timeIntervalSince1970 * 1000 }

  private func run(
    waiting: ArgusProtocol.UpcomingWait?, until: Double? = nil, teammate: String? = nil,
    once: Bool = false
  ) -> ArgusProtocol.UpcomingRun {
    ArgusProtocol.UpcomingRun(
      automationId: "a", name: "Nightly", teammateId: teammate == nil ? nil : "t", teammateName: teammate,
      triggerKind: once ? .once : .schedule, nextRunAt: nowMs + 2 * 3_600_000, waiting: waiting,
      waitingUntil: until)
  }

  @Test("a failure names its kind and when a limit resets")
  func failure() {
    #expect(Labels.threadFailureTitle(.limit) == "Stopped at the usage limit")
    #expect(Labels.threadFailureTitle(.interrupted) == "Interrupted by a restart")
    let plain = ArgusProtocol.TeammateThreadFailure(kind: .error, reason: "Boom.", at: nowMs)
    #expect(Labels.threadFailureDetail(plain, now: now) == "Boom.")
    let limit = ArgusProtocol.TeammateThreadFailure(
      kind: .limit, reason: "Hit the usage limit.", at: nowMs, resetsAt: nowMs)
    #expect(Labels.threadFailureDetail(limit, now: now).hasPrefix("Hit the usage limit. It resets at "))
  }

  @Test("an upcoming run says what it waits on")
  func waits() {
    #expect(Labels.upcomingWaitLabel(run(waiting: nil)) == nil)
    #expect(Labels.upcomingWaitLabel(run(waiting: .paused)) == "Paused")
    #expect(Labels.upcomingWaitLabel(run(waiting: .limit)) == "Waits for the usage limit to reset")
    #expect(
      Labels.upcomingWaitLabel(run(waiting: .limit, until: nowMs), now: now)?
        .hasPrefix("Waits for the usage limit to reset at ") == true)
    #expect(Labels.upcomingWhen(run(waiting: nil), now: now).hasPrefix("in 2h · "))
    #expect(Labels.upcomingSubtitle(run(waiting: nil, teammate: "CI Fixer", once: true)) == "Once · CI Fixer's duty")
    #expect(Labels.upcomingSubtitle(run(waiting: nil)) == "Automation")
  }
}
