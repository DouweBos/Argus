package dev.houwert.argus.core.stores

/**
 * What the shared stores did that an app may want to count. The stores know
 * no analytics SDK; the app maps these onto its own catalog.
 */
sealed interface StoreEvent {
  enum class AgentAction(val wire: String) { Interrupt("interrupt"), Stop("stop"), Model("model"), Effort("effort"), PermissionMode("permission_mode") }

  enum class AccountAction(val wire: String) { Select("select"), Add("add"), Remove("remove"), Rename("rename"), Reauth("reauth"), Pin("pin") }

  enum class MemoryAction(val wire: String) { Save("save"), Delete("delete") }

  enum class AutomationAction(val wire: String) {
    Create("create"), Save("save"), Delete("delete"), Enable("enable"), Disable("disable"),
    RevisePlaybook("revise_playbook"), Describe("describe"), Regenerate("regenerate"), Duplicate("duplicate"),
  }

  enum class RunAction(val wire: String) {
    Start("start"), StartScratch("start_scratch"), ScheduleScratch("schedule_scratch"), Cancel("cancel"),
    Feedback("feedback"), SaveScratch("save_scratch"), Delete("delete"), MarkRead("mark_read"),
  }

  enum class OfflineReplyAction(val wire: String) { Queued("queued"), Replayed("replayed"), Discarded("discarded") }

  enum class ProposalAction(val wire: String) {
    Accept("accept"), Dismiss("dismiss"), Resolve("resolve"), Cleanup("cleanup"), RequestRevision("request_revision"),
  }

  enum class PullRequestAction(val wire: String) { Open("open"), Merge("merge"), Comment("comment"), Fill("fill"), View("view") }

  enum class BranchAction(val wire: String) {
    Checkout("checkout"), Create("create"), Delete("delete"), Merge("merge"), Rebase("rebase"), Push("push"),
    Pull("pull"), Rename("rename"), Pin("pin"), StashApply("stash_apply"), StashPop("stash_pop"), StashDrop("stash_drop"),
  }

  enum class DiffReviewAction(val wire: String) { Comment("comment"), Delete("delete"), Send("send"), Discard("discard"), RequestReview("request_review") }

  enum class DiffScopeKind(val wire: String) { Uncommitted("uncommitted"), LastTurn("last_turn"), Turn("turn"), Branch("branch") }

  enum class ReviewGuideAction(val wire: String) { Open("open"), Completed("completed") }

  enum class LandAction(val wire: String) { Commit("commit"), Amend("amend"), Push("push"), Merge("merge") }

  data class MessageSent(val queued: Boolean, val hasImages: Boolean, val length: Int) : StoreEvent
  data class MessageSendFailed(val retried: Boolean) : StoreEvent
  data class PermissionAnswered(val approved: Boolean, val alwaysAllow: Boolean, val fromNotification: Boolean) : StoreEvent
  data class AgentControlled(val action: AgentAction) : StoreEvent
  /** [strategy] only means something for a merge. */
  data class WorkLanded(val action: LandAction, val success: Boolean, val strategy: String? = null) : StoreEvent
  data class CommitComposed(val hasDescription: Boolean, val signOff: Boolean, val signed: Boolean) : StoreEvent
  data class ClaudeAccountChanged(val action: AccountAction) : StoreEvent
  data class AutomationEdited(val action: AutomationAction) : StoreEvent
  data class RunActed(val action: RunAction) : StoreEvent
  data class ProposalHandled(val action: ProposalAction) : StoreEvent
  data class PullRequestActed(val action: PullRequestAction) : StoreEvent
  data class BranchActed(val action: BranchAction) : StoreEvent
  /** [target] says whether the display name or the branch moved. */
  data class SessionRenamed(val target: String) : StoreEvent
  data class MemoryEdited(val action: MemoryAction) : StoreEvent
  data class DiffReviewed(val action: DiffReviewAction, val comments: Int) : StoreEvent
  data class DiffScoped(val scope: DiffScopeKind) : StoreEvent
  data class TimelineOpened(val turns: Int) : StoreEvent
  data class ReviewGuideUsed(val action: ReviewGuideAction, val stops: Int) : StoreEvent
  data class OfflineReply(val action: OfflineReplyAction) : StoreEvent
}
