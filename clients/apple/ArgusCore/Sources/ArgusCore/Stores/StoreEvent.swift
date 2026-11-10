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
    /// An account that was signed out was signed in again.
    case reauth
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
    /// A shown draft drafted again from the same description.
    case regenerate
    /// A paused copy of an existing automation.
    case duplicate
  }

  /// What was done to a run.
  public enum RunAction: String, Sendable {
    case start
    case startScratch = "start_scratch"
    /// A quick run set to run later, saved as a run-once automation.
    case scheduleScratch = "schedule_scratch"
    case cancel
    case feedback
    case saveScratch = "save_scratch"
    case delete
    case markRead = "mark_read"
  }

  /// What happened to a reply written while offline.
  public enum OfflineReplyAction: String, Sendable {
    case queued
    /// Sent once the connection came back.
    case replayed
    case discarded
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
    /// Claude filled in a new PR's description.
    case fill
    /// A session's open PR was opened from where it would otherwise merge.
    case view
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
    case stashApply = "stash_apply"
    case stashPop = "stash_pop"
    case stashDrop = "stash_drop"
  }

  /// What was done with a diff review.
  public enum DiffReviewAction: String, Sendable {
    /// A draft comment was added to a diff line.
    case comment
    /// A draft comment was deleted.
    case delete
    /// Every draft was sent to the agent as one message.
    case send
    /// Every draft was discarded unsent.
    case discard
    /// A fresh agent was asked to review the diff.
    case requestReview = "request_review"
  }

  /// How work leaves a session.
  public enum LandAction: String, Sendable {
    case commit
    case amend
    case push
    case merge
  }

  case messageSent(queued: Bool, hasImages: Bool, length: Int)
  case messageSendFailed(retried: Bool)
  case permissionAnswered(approved: Bool, alwaysAllow: Bool, fromNotification: Bool)
  case agentControlled(action: AgentAction)
  /// `strategy` is only meaningful for a merge — nil elsewhere.
  case workLanded(action: LandAction, success: Bool, strategy: String? = nil)
  /// Which composer parts a successful commit used.
  case commitComposed(hasDescription: Bool, signOff: Bool, signed: Bool)
  case claudeAccountChanged(action: AccountAction)
  case automationEdited(action: AutomationAction)
  case runActed(action: RunAction)
  case proposalHandled(action: ProposalAction)
  case pullRequestActed(action: PullRequestAction)
  case branchActed(action: BranchAction)
  /// `target` says whether the session's display name or its branch moved.
  case sessionRenamed(target: String)
  case memoryEdited(action: MemoryAction)
  /// `comments` is how many drafts the session holds once the action is done (sent: how many went).
  case diffReviewed(action: DiffReviewAction, comments: Int)
  case offlineReply(action: OfflineReplyAction)
}
