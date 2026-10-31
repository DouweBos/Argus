import ArgusCore
import ArgusKit
import Foundation

/// The model, effort, permission-mode, account and linked-project pickers. A
/// start composer keeps its picks as a draft for the agent it starts.
extension ComposerModel {
  /// The account picker's value for "follow the computer's active account".
  public static let followDefaultAccount = ""

  public var permissionMode: RemotePermissionMode {
    if let starter { return draftMode ?? ComposerPermissionMode.canonical(starter.defaultMode) }
    return ComposerPermissionMode.canonical(status?.permissionMode)
  }

  /// This agent's models; with no agent yet (or none reported), any agent's on the computer.
  public var models: [RemoteModelInfo] {
    ComposerOptions.models(own: capabilities.models, byAgent: host.capabilitiesByAgent)
  }

  /// The model picked for the agent; nil is the CLI default.
  public var pickedModel: String? {
    if let starter { return draftModel ?? starter.defaultModel }
    return status?.model
  }

  public var modelLabel: String { ModelName.label(for: pickedModel, in: models) ?? "Model" }

  public var effortLevels: [String] {
    ComposerEffort.levels(for: ComposerOptions.current(pickedModel, in: models))
  }

  public var effort: String? { starter != nil ? draftEffort : host.effortByAgent[agentId] }

  public var linkableProjects: [RemoteProject] {
    ComposerOptions.linkable(host.projects, ownRepoRoot: sessionId.flatMap { host.repoRoot(forSessionId: $0) })
  }

  /// With one account there's nothing to switch between, and a start composer has no session pin.
  public var offersAccounts: Bool {
    starter == nil && sessionId != nil && (host.claudeAccounts?.count ?? 0) > 1
  }

  public var accounts: [RemoteClaudeAccount] { host.claudeAccounts ?? [] }

  /// The session's pinned account, or `followDefaultAccount`.
  public var accountId: String {
    sessionId.flatMap { host.claudeAccountId(forSessionId: $0) } ?? Self.followDefaultAccount
  }

  public func accountName(_ id: String?) -> String? {
    host.claudeAccounts?.first { $0.id == id }?.displayName
  }

  public var accountLabel: String { accountName(accountId) ?? "Default account" }

  public var activeAccountName: String? { accountName(host.activeClaudeAccountId) }

  public func setModel(_ value: String) {
    if starter != nil {
      draftModel = value
      // Effort levels are per model.
      draftEffort = nil
    } else {
      Task { await host.setModel(agentId: agentId, model: value) }
    }
  }

  public func setEffort(_ level: String?) {
    if starter != nil {
      draftEffort = level
    } else {
      Task { await host.setEffort(agentId: agentId, level: level) }
    }
  }

  public func setPermissionMode(_ mode: RemotePermissionMode) {
    if starter != nil {
      draftMode = mode
    } else {
      Task { await host.setPermissionMode(agentId: agentId, mode: mode) }
    }
  }

  public func setAccount(_ value: String) {
    guard let sessionId else { return }
    let accountId = value == Self.followDefaultAccount ? nil : value
    Task { await host.setSessionClaudeAccount(sessionId: sessionId, accountId: accountId, agentId: agentId) }
  }

  public func toggleLink(_ repoRoot: String) {
    let on = !linkedProjects.contains(repoRoot)
    linkedProjects.removeAll { $0 == repoRoot }
    if on { linkedProjects.append(repoRoot) }
    preferences.encode(linkedProjects, for: PreferenceKey.linkedProjects(agentId: agentId))
  }

  public func interrupt() {
    Task { await host.interrupt(agentId: agentId) }
  }
}
