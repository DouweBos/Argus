import ArgusCore
import Foundation

extension WorkLog {
  /// "Worked for 5m 29s", "Working for 12s" while the agent is still at it, or
  /// the call count when there's no span; plus whatever is still running.
  public func label(working: Bool, now: Date) -> String {
    let base = workLabel(working: working, now: now)
    guard let stillRunning else { return base }
    return "\(base) · \(stillRunning)"
  }

  /// "3 tool calls".
  public var callCountLabel: String {
    let count = ToolGroups.countToolCalls(messages)
    return "\(count) tool call\(count == 1 ? "" : "s")"
  }

  private func workLabel(working: Bool, now: Date) -> String {
    if working {
      guard let started else { return "Working…" }
      return "Working for \(ChromeText.duration(now.timeIntervalSince1970 - started / 1000))"
    }
    let end = ended ?? messages.last?.timestamp
    guard let started = started ?? messages.first?.timestamp, let end, end > started else {
      return callCountLabel
    }
    return "Worked for \(ChromeText.duration((end - started) / 1000))"
  }
}
