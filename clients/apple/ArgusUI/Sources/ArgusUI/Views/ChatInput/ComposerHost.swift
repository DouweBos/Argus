import ArgusCore
import ArgusKit
import Foundation

/// The slice of `HostStore` a composer reads and acts on, so `ComposerModel`
/// can be driven by a fake in tests.
@MainActor
public protocol ComposerHost: AnyObject {
  var statusByAgent: [String: RemoteAgentStatus] { get }
  var capabilitiesByAgent: [String: RemoteAgentCapabilities] { get }
  var startOptionsBySession: [String: RemoteAgentCapabilities] { get }
  var followUpsByAgent: [String: [String]] { get }
  var effortByAgent: [String: String] { get }
  var claudeAccounts: [RemoteClaudeAccount]? { get }
  var activeClaudeAccountId: String? { get }
  var projects: [RemoteProject] { get }
  var runners: [RemoteRunner] { get }
  var sessionsByRepo: [String: [RemoteSession]] { get }
  var usageLimits: ArgusProtocol.ClaudeUsageLimits? { get }

  func claudeAccountId(forSessionId id: String) -> String?
  func repoRoot(forSessionId id: String) -> String?
  func visibleMessages(for key: String) -> [RemoteMessage]
  func lastKnownModels(runnerId: String?) -> [RemoteModelInfo]

  func sendMessage(
    agentId: String, message: String, images: [RemoteImageAttachment], displayText: String?, isRetry: Bool
  ) async
  func queueMessage(agentId: String, message: String, images: [RemoteImageAttachment], displayText: String) async
  func interrupt(agentId: String) async
  func setModel(agentId: String, model: String) async
  func setPermissionMode(agentId: String, mode: RemotePermissionMode) async
  func setEffort(agentId: String, level: String?) async
  func setSessionClaudeAccount(sessionId: String, accountId: String?, agentId: String) async

  func loadCapabilities(agentId: String) async
  func loadQueue(agentId: String) async
  func loadStartOptions(sessionId: String, runnerId: String?) async
  func loadSessions(repoRoot: String) async
  func refreshClaudeAccounts() async
  func loadUsageLimits(refresh: Bool) async
  func listFiles(sessionId: String) async -> [String]
  func resolveMentionPath(sessionId: String, query: String) async -> RemoteMentionPathResult?
  func hostPaths(forDropped urls: [URL], sessionId: String?) async -> HostStore.DroppedFiles
}

extension HostStore: ComposerHost {}

/// The platform text view behind a composer, for the edits a binding can't
/// express: undoable replacements, caret placement and focus.
@MainActor
public protocol ComposerEditor: AnyObject {
  /// UTF-16 offset of the insertion point.
  var caret: Int { get }
  /// Replace the whole text as one undoable edit, caret at `caret` (UTF-16; nil is the end).
  func replace(with text: String, caret: Int?)
  /// Start over — after a send, undo shouldn't resurrect the message.
  func reset()
  /// Put `text` back without recording an edit, so the next `replace` undoes to it.
  func restore(_ text: String)
  func focus()
}

/// What arrived by paste or drop, for the composer to attach or mention.
enum ComposerDrop {
  case images([PendingImage], pasted: Bool)
  case files([URL])
  case element(PickedElement)
}
