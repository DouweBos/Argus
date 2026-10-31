import ArgusKit
import Foundation

/// The decisions an agent is waiting on, and how each one is headed.
public enum PendingPrompts {
  /// Top-level calls still awaiting a decision. Decisions sit at the tail, so
  /// only the last `window` messages are walked.
  public static func calls(
    in messages: [RemoteMessage], window: Int = 40, isPending: (RemoteToolCall) -> Bool
  ) -> [RemoteToolCall] {
    messages.suffix(window).flatMap { $0.toolCalls.filter(isPending) }
  }

  public static func title(for call: RemoteToolCall) -> String {
    switch PendingForm.of(name: call.name, input: call.input) {
    case .question: "Question from the agent"
    case .plan: "Plan ready for review"
    case .buttons: "Permission needed"
    }
  }
}

extension HostStore {
  /// Top-level calls in `messages` the agent is waiting on.
  public func pendingCalls(agentKey: String, in messages: [RemoteMessage]) -> [RemoteToolCall] {
    PendingPrompts.calls(in: messages) { isToolCallPending(agentKey: agentKey, call: $0) }
  }
}
