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

  /// This agent's models; with no agent yet (or none reported), what the runner last
  /// reported, else any agent's on the computer. A custom runner's declared models
  /// replace them: its gateway would reject the ids a Claude Code handshake reported.
  public var models: [RemoteModelInfo] {
    if starter != nil {
      if let declared = runner?.models, !declared.isEmpty {
        return declared.map {
          RemoteModelInfo(value: $0.value, displayName: $0.displayName, description: $0.description ?? "")
        }
      }
      if capabilities.models.isEmpty {
        let reported = host.lastKnownModels(runnerId: runner?.id)
        if !reported.isEmpty { return reported }
      }
    }
    return ComposerOptions.models(own: capabilities.models, byAgent: host.capabilitiesByAgent)
  }

  /// A runner's declared models name no default of their own, so none is presumed.
  private var declaresModels: Bool { !(runner?.models.isEmpty ?? true) }

  /// The model picked for the agent; nil is the CLI default. The starter's
  /// default belongs to the default runner, so a picked runner starts on its own.
  public var pickedModel: String? {
    if let starter { return draftModel ?? (runner == nil ? starter.defaultModel : nil) }
    return status?.model
  }

  public var modelLabel: String {
    if pickedModel == nil, declaresModels { return "Default" }
    return ModelName.label(for: pickedModel, in: models) ?? "Model"
  }

  /// A custom runner's models say nothing about effort, so it offers none.
  public var effortLevels: [String] {
    guard offersImagesAndEffort, !declaresModels else { return [] }
    return ComposerEffort.levels(for: ComposerOptions.current(pickedModel, in: models))
  }

  public var effort: String? { starter != nil ? draftEffort : host.effortByAgent[agentId] }

  public var linkableProjects: [RemoteProject] {
    ComposerOptions.linkable(host.projects, ownRepoRoot: sessionId.flatMap { host.repoRoot(forSessionId: $0) })
  }

  /// With one account there's nothing to switch between, and only Claude Code runs on one.
  public var offersAccounts: Bool {
    guard (host.claudeAccounts?.count ?? 0) > 1 else { return false }
    if starter != nil { return runner == nil || runner?.id == "claude-code" }
    return sessionId != nil
  }

  public var accounts: [RemoteClaudeAccount] { host.claudeAccounts ?? [] }

  /// A start's pick, else the session's pinned account, or `followDefaultAccount`.
  public var accountId: String {
    if starter != nil, let draftAccount { return draftAccount }
    return sessionId.flatMap { host.claudeAccountId(forSessionId: $0) } ?? Self.followDefaultAccount
  }

  public func accountName(_ id: String?) -> String? {
    host.claudeAccounts?.first { $0.id == id }?.displayName
  }

  public var accountLabel: String { accountName(accountId) ?? "Default account" }

  public var activeAccountName: String? { accountName(host.activeClaudeAccountId) }

  /// The account a live agent's process runs as; nil before a start or from older hosts.
  public var runningAccountId: String? { starter == nil ? status?.accountId : nil }

  /// Before an agent has talked nothing runs yet, so following the computer's default is a choice;
  /// after that only the account it runs on matters.
  public var offersFollowDefault: Bool { !hasConversation }

  /// A picked account the agent moves to once its turn ends.
  public var hasPendingAccountSwitch: Bool {
    guard accountId != Self.followDefaultAccount, let running = runningAccountId else { return false }
    return running != accountId
  }

  /// The account the agent runs on, or the one it moves to after this turn.
  public var currentAccountId: String? {
    if hasPendingAccountSwitch { return accountId }
    return runningAccountId ?? (accountId == Self.followDefaultAccount ? host.activeClaudeAccountId : accountId)
  }

  /// The account picker's ticked row: an agent's account, else the pick or `followDefaultAccount`.
  public var checkedAccountId: String { offersFollowDefault ? accountId : currentAccountId ?? accountId }

  public func accountHint(_ id: String) -> String? {
    !offersFollowDefault && hasPendingAccountSwitch && id == accountId ? "After this turn" : nil
  }

  /// The account the agent is on, else the one it will start on.
  public var effectiveAccountName: String? {
    accountName(runningAccountId) ?? (accountId == Self.followDefaultAccount ? activeAccountName : accountName(accountId))
  }

  public func setModel(_ value: String) {
    if starter != nil {
      draftModel = value
      // Effort levels are per model.
      draftEffort = nil
    } else {
      Task { await host.setModel(agentId: agentId, model: value) }
    }
  }

  /// Model ids don't carry across runners, so a switch drops the model and its effort.
  public func setRunner(_ value: RemoteRunner?) {
    guard value?.id != runner?.id else { return }
    runner = value
    draftModel = nil
    draftEffort = nil
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
    // A start pins it with the agent, so its first turn already runs there.
    if starter != nil { return draftAccount = value }
    guard let sessionId, value != checkedAccountId else { return }
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
