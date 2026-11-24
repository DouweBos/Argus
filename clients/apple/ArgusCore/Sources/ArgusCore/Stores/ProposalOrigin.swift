import Foundation

/// Where a proposal was raised: an automation's run, or a teammate
/// conversation, whose proposals carry `teammate-chat:<id>` / `thread:<id>`.
public enum ProposalOrigin: Equatable, Sendable {
  case run(automationId: String, runId: String)
  case teammateThread(teammateId: String, threadId: String)

  static let chatPrefix = "teammate-chat:"
  static let threadPrefix = "thread:"

  /// Nil when the proposal has no run to open.
  public init?(automationId: String, runId: String?) {
    guard let runId, !runId.isEmpty else { return nil }
    if automationId.hasPrefix(Self.chatPrefix), runId.hasPrefix(Self.threadPrefix) {
      let teammateId = String(automationId.dropFirst(Self.chatPrefix.count))
      let threadId = String(runId.dropFirst(Self.threadPrefix.count))
      if !teammateId.isEmpty, !threadId.isEmpty {
        self = .teammateThread(teammateId: teammateId, threadId: threadId)
        return
      }
    }
    self = .run(automationId: automationId, runId: runId)
  }

  public var route: ArgusRoute {
    switch self {
    case .run(let automationId, let runId): .automation(id: automationId, runId: runId)
    case .teammateThread(let teammateId, let threadId): .teammate(id: teammateId, page: .chat(threadId: threadId))
    }
  }
}
