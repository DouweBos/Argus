import Foundation

/// Calls launched with `run_in_background`: the host marks them running until
/// the CLI's task notification settles them. Mirrors the host's `background.ts`.
public enum BackgroundTasks {
  /// The messages' own calls still running in the background.
  public static func running(in messages: [RemoteMessage]) -> [RemoteToolCall] {
    messages.flatMap { message in message.toolCalls.filter { $0.background?.status == .running } }
  }

  /// When the last settled background call finished, epoch milliseconds.
  public static func lastFinished(in messages: [RemoteMessage]) -> Double? {
    messages.flatMap(\.toolCalls).compactMap { call -> Double? in
      guard let task = call.background, task.status != .running, let duration = task.durationMs else { return nil }
      return task.startedAt + duration
    }.max()
  }

  /// "1 agent still running", "2 background tasks still running", or nil.
  public static func stillRunningLabel(_ calls: [RemoteToolCall]) -> String? {
    let count = calls.count
    guard count > 0 else { return nil }
    if calls.allSatisfy({ ToolCallSummary.isSubagent($0.name) }) {
      return "\(count) \(count == 1 ? "agent" : "agents") still running"
    }
    return "\(count) background \(count == 1 ? "task" : "tasks") still running"
  }
}
