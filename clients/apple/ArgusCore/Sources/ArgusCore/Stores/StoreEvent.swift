import Foundation

/// What the shared stores did that an app may want to count. The stores don't
/// know about any analytics SDK; each app maps these onto its own catalog, so
/// the wrong props still fail to compile on both ends.
public enum StoreEvent: Sendable, Equatable {
  /// What can be done to a running agent.
  public enum AgentAction: String, Sendable {
    case interrupt
    case stop
    case model
    case effort
    case permissionMode = "permission_mode"
  }

  /// What was done to the Claude accounts this computer has signed in.
  public enum AccountAction: String, Sendable {
    case select
    case add
    case remove
    case rename
    /// A session pinned to one account from the chat input.
    case pin
  }

  /// What happened to an automation's memory.
  public enum MemoryAction: String, Sendable {
    case save
    case delete
  }

  /// What was done to an automation's definition.
  public enum AutomationAction: String, Sendable {
    case create
    case save
    case delete
    case enable
    case disable
    case revisePlaybook = "revise_playbook"
    /// Drafted from a description; nothing is saved until it is created.
    case describe
  }

  /// What was done to a run.
  public enum RunAction: String, Sendable {
    case start
    case startScratch = "start_scratch"
    case cancel
    case feedback
    case saveScratch = "save_scratch"
    case delete
    case markRead = "mark_read"
  }

  /// How an inbox proposal was answered.
  public enum ProposalAction: String, Sendable {
    case accept
    case dismiss
    case resolve
    case cleanup
    case requestRevision = "request_revision"
  }

  /// What was done to a pull request.
  public enum PullRequestAction: String, Sendable {
    case open
    case merge
    case comment
  }

  /// What was done to a branch.
  public enum BranchAction: String, Sendable {
    case checkout
    case create
    case delete
    case merge
    case rebase
    case push
    case pull
    case rename
    case pin
  }

  /// How work leaves a session.
  public enum LandAction: String, Sendable {
    case commit
    case push
    case merge
  }

  case messageSent(queued: Bool, hasImages: Bool, length: Int)
  case messageSendFailed(retried: Bool)
  case permissionAnswered(approved: Bool, fromNotification: Bool)
  case agentControlled(action: AgentAction)
  /// `strategy` is only meaningful for a merge — nil elsewhere.
  case workLanded(action: LandAction, success: Bool, strategy: String? = nil)
  case claudeAccountChanged(action: AccountAction)
  case automationEdited(action: AutomationAction)
  case runActed(action: RunAction)
  case proposalHandled(action: ProposalAction)
  case pullRequestActed(action: PullRequestAction)
  case branchActed(action: BranchAction)
  /// `target` says whether the session's display name or its branch moved.
  case sessionRenamed(target: String)
  case memoryEdited(action: MemoryAction)
}
