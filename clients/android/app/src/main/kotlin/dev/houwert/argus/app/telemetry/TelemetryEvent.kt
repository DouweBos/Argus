package dev.houwert.argus.app.telemetry

import dev.houwert.argus.core.files.FilePreviewKind
import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.kit.storage.RemoteEndpoint

/**
 * Every event this app sends, each subclass carrying its own props, so wrong props don't compile.
 * The iPhone's `TelemetryEvent` with `android_` for `ios_`; anything the computer already counts
 * when the phone asks (`agent_started`, `session_created`, `session_merged`) is absent on purpose.
 *
 * Every event and prop is documented in `docs/telemetry-events.md`; `telemetryDocs.test.ts` fails otherwise.
 */
sealed interface TelemetryEvent {
  val name: String
  val properties: Map<String, Any> get() = emptyMap()

  // Lifecycle and connection

  data object Launched : TelemetryEvent {
    override val name = "android_launched"
  }

  data class Paired(val endpointKind: String, val hasControl: Boolean) : TelemetryEvent {
    override val name = "android_paired"
    override val properties get() = mapOf("endpoint_kind" to endpointKind, "has_control" to hasControl)
  }

  /** The failure's case name only, never its detail. */
  data class PairFailed(val reason: String) : TelemetryEvent {
    override val name = "android_pair_failed"
    override val properties get() = mapOf("reason" to reason)
  }

  data class HostSwitched(val hostCount: Int) : TelemetryEvent {
    override val name = "android_host_switched"
    override val properties get() = mapOf("host_count" to hostCount)
  }

  /** A live connection moved to a better route without dropping. */
  data class RouteUpgraded(val from: RemoteEndpoint.Kind, val to: RemoteEndpoint.Kind) : TelemetryEvent {
    override val name = "android_route_upgraded"
    override val properties get() = mapOf("from" to from.wire, "to" to to.wire)
  }

  /** A link, shortcut, widget, share or notification opened a screen; [screen] is its route pattern. */
  data class LinkOpened(val screen: String, val via: LinkSource, val fallback: Boolean) : TelemetryEvent {
    override val name = "android_link_opened"
    override val properties get() = mapOf("screen" to screen, "via" to via.wire, "fallback" to fallback)
  }

  /** Once a launch: how many of each home-screen widget are placed. */
  data class WidgetsInstalled(val agents: Int, val inbox: Int, val usage: Int) : TelemetryEvent {
    override val name = "android_widgets_installed"
    override val properties get() = mapOf("agents" to agents, "inbox" to inbox, "usage" to usage)
  }

  /** The computer was out of reach and the phone showed what it had saved; [ageSeconds] is bucketed. */
  data class SavedShown(val ageSeconds: Long) : TelemetryEvent {
    override val name = "android_saved_shown"
    override val properties get() = mapOf("age_bucket" to ageBucket(ageSeconds))
  }

  // Store events (mapped in Telemetry.from)

  data class MessageSent(val queued: Boolean, val hasImages: Boolean, val length: Int) : TelemetryEvent {
    override val name = "android_message_sent"
    override val properties get() = mapOf("queued" to queued, "has_images" to hasImages, "length_bucket" to lengthBucket(length))
  }

  data class MessageSendFailed(val retried: Boolean) : TelemetryEvent {
    override val name = "android_message_send_failed"
    override val properties get() = mapOf("retried" to retried)
  }

  data class PermissionAnswered(val approved: Boolean, val alwaysAllow: Boolean, val fromNotification: Boolean) : TelemetryEvent {
    override val name = "android_permission_answered"
    override val properties get() = mapOf("approved" to approved, "always_allow" to alwaysAllow, "from_notification" to fromNotification)
  }

  data class AgentControlled(val action: StoreEvent.AgentAction) : TelemetryEvent {
    override val name = "android_agent_controlled"
    override val properties get() = mapOf("action" to action.wire)
  }

  /** [strategy] only means something for a merge. */
  data class WorkLanded(val action: StoreEvent.LandAction, val success: Boolean, val strategy: String? = null) : TelemetryEvent {
    override val name = "android_work_landed"
    override val properties get() = mapOf("action" to action.wire, "success" to success, "strategy" to (strategy ?: "none"))
  }

  data class CommitComposed(val hasDescription: Boolean, val signOff: Boolean, val signed: Boolean) : TelemetryEvent {
    override val name = "android_commit_composed"
    override val properties get() = mapOf("has_description" to hasDescription, "sign_off" to signOff, "signed" to signed)
  }

  data class ClaudeAccountChanged(val action: StoreEvent.AccountAction) : TelemetryEvent {
    override val name = "android_claude_account_changed"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class AutomationEdited(val action: StoreEvent.AutomationAction) : TelemetryEvent {
    override val name = "android_automation_edited"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class RunActed(val action: StoreEvent.RunAction) : TelemetryEvent {
    override val name = "android_run_acted"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class ProposalHandled(val action: StoreEvent.ProposalAction) : TelemetryEvent {
    override val name = "android_proposal_handled"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class PullRequestActed(val action: StoreEvent.PullRequestAction) : TelemetryEvent {
    override val name = "android_pull_request_acted"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class BranchActed(val action: StoreEvent.BranchAction) : TelemetryEvent {
    override val name = "android_branch_acted"
    override val properties get() = mapOf("action" to action.wire)
  }

  /** [target] says whether the session's display name or its branch moved. */
  data class SessionRenamed(val target: String) : TelemetryEvent {
    override val name = "android_session_renamed"
    override val properties get() = mapOf("target" to target)
  }

  data class MemoryEdited(val action: StoreEvent.MemoryAction) : TelemetryEvent {
    override val name = "android_memory_edited"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class DiffReviewed(val action: StoreEvent.DiffReviewAction, val comments: Int) : TelemetryEvent {
    override val name = "android_diff_reviewed"
    override val properties get() = mapOf("action" to action.wire, "comment_count" to comments)
  }

  data class DiffScoped(val scope: StoreEvent.DiffScopeKind) : TelemetryEvent {
    override val name = "android_diff_scope_changed"
    override val properties get() = mapOf("scope" to scope.wire)
  }

  data class TimelineOpened(val turns: Int) : TelemetryEvent {
    override val name = "android_timeline_opened"
    override val properties get() = mapOf("turn_count" to turns)
  }

  data class ReviewGuideUsed(val action: StoreEvent.ReviewGuideAction, val stops: Int) : TelemetryEvent {
    override val name = "android_review_guide_used"
    override val properties get() = mapOf("action" to action.wire, "stop_count" to stops)
  }

  data class OfflineReply(val action: StoreEvent.OfflineReplyAction) : TelemetryEvent {
    override val name = "android_offline_reply"
    override val properties get() = mapOf("action" to action.wire)
  }

  // Screens

  data class DeviceWatched(val durationMs: Long, val interacted: Boolean) : TelemetryEvent {
    override val name = "android_device_watched"
    override val properties get() = mapOf("duration_ms" to durationMs, "interacted" to interacted)
  }

  /** The image on screen in the viewer was copied or shared. */
  data class ImageViewerUsed(val action: ImageViewerAction) : TelemetryEvent {
    override val name = "android_image_viewer_used"
    override val properties get() = mapOf("action" to action.wire)
  }

  /** A project's folded Done and Snoozed sessions were shown or hidden. */
  data class SessionsFoldToggled(val expanded: Boolean, val done: Int, val snoozed: Int) : TelemetryEvent {
    override val name = "android_sessions_fold_toggled"
    override val properties get() = mapOf("expanded" to expanded, "done" to done, "snoozed" to snoozed)
  }

  data class ProjectCollapseToggled(val collapsed: Boolean, val source: ProjectListSource) : TelemetryEvent {
    override val name = "android_project_collapse_toggled"
    override val properties get() = mapOf("collapsed" to collapsed, "source" to source.wire)
  }

  /** The inbox's shortcut into the run a proposal came out of. */
  data object ProposalOpenedAsRun : TelemetryEvent {
    override val name = "android_proposal_opened"
  }

  data class InboxFiltered(val by: InboxFilterField) : TelemetryEvent {
    override val name = "android_inbox_filtered"
    override val properties get() = mapOf("by" to by.wire)
  }

  /** A suggested reply filled the message field. */
  data object FollowUpUsed : TelemetryEvent {
    override val name = "android_follow_up_used"
  }

  /** A message-field feature the host can't see; follow-ups have their own event. */
  data class InputUsed(val affordance: InputAffordance) : TelemetryEvent {
    override val name = "android_input_used"
    override val properties get() = mapOf("affordance" to affordance.wire)
  }

  data class SettingChanged(val setting: Setting, val enabled: Boolean) : TelemetryEvent {
    override val name = "android_setting_changed"
    override val properties get() = mapOf("setting" to setting.wire, "enabled" to enabled)
  }

  /** A colour theme preset id. */
  data class ColorThemeChanged(val theme: String) : TelemetryEvent {
    override val name = "android_color_theme_changed"
    override val properties get() = mapOf("theme" to theme)
  }

  data class AppearanceChanged(val appearance: Appearance) : TelemetryEvent {
    override val name = "android_appearance_changed"
    override val properties get() = mapOf("appearance" to appearance.wire)
  }

  /** [value] is the enum's wire value, or `computer` / `none` when cleared. */
  data class DefaultChanged(val setting: DefaultSetting, val value: String) : TelemetryEvent {
    override val name = "android_default_changed"
    override val properties get() = mapOf("setting" to setting.wire, "value" to value)
  }

  /** The start sheet sent its agent off; `changed*` say it isn't what the sheet opened on. */
  data class AgentStartSubmitted(
    val workspace: StartWorkspace,
    val changedWorkspace: Boolean,
    val hasImages: Boolean,
    val effortSet: Boolean,
    val changedProject: Boolean,
  ) : TelemetryEvent {
    override val name = "android_agent_start_submitted"
    override val properties get() = mapOf(
      "workspace" to workspace.wire, "changed_workspace" to changedWorkspace, "has_images" to hasImages,
      "effort_set" to effortSet, "changed_project" to changedProject,
    )
  }

  /** A share into Argus ended; [workspace] is where it started, or null. */
  data class ShareFinished(
    val outcome: ShareOutcome,
    val hasImages: Boolean,
    val hasLink: Boolean,
    val hasText: Boolean,
    val workspace: StartWorkspace?,
  ) : TelemetryEvent {
    override val name = "android_share_finished"
    override val properties get() = mapOf(
      "outcome" to outcome.wire, "has_images" to hasImages, "has_link" to hasLink, "has_text" to hasText,
      "workspace" to (workspace?.wire ?: "none"),
    )
  }

  data class WarningsOpened(val count: Int) : TelemetryEvent {
    override val name = "android_warnings_opened"
    override val properties get() = mapOf("count" to count)
  }

  data class NotificationsCleared(val scope: ClearScope) : TelemetryEvent {
    override val name = "android_notifications_cleared"
    override val properties get() = mapOf("scope" to scope.wire)
  }

  data object McpServersOpened : TelemetryEvent {
    override val name = "android_mcp_servers_opened"
  }

  data class SessionUsed(val action: SessionAction) : TelemetryEvent {
    override val name = "android_session_used"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class HomeUsed(val action: HomeAction) : TelemetryEvent {
    override val name = "android_home_used"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class NewSessionOpened(val source: NewSessionSource) : TelemetryEvent {
    override val name = "android_new_session_opened"
    override val properties get() = mapOf("source" to source.wire)
  }

  data class BlueprintOpened(val screen: BlueprintScreen) : TelemetryEvent {
    override val name = "android_blueprint_opened"
    override val properties get() = mapOf("screen" to screen.wire)
  }

  /** A turn's folded work was opened; [working] says the agent was still on it. */
  data class TranscriptWorkLogOpened(val working: Boolean) : TelemetryEvent {
    override val name = "android_transcript_work_log_opened"
    override val properties get() = mapOf("working" to working)
  }

  data object ArtifactOpened : TelemetryEvent {
    override val name = "android_artifact_opened"
  }

  /** [success] says the host took the edit or fork (always true for copy). */
  data class MessageActionUsed(val action: MessageAction, val role: MessageRole, val success: Boolean) : TelemetryEvent {
    override val name = "android_message_action"
    override val properties get() = mapOf("action" to action.wire, "role" to role.wire, "success" to success)
  }

  data class ChatHistoryUsed(val action: ChatHistoryAction) : TelemetryEvent {
    override val name = "android_chat_history_used"
    override val properties get() = mapOf("action" to action.wire)
  }

  /** [language] is a bundled grammar's id or `other`, never a file name. */
  data class FileViewed(val source: FileViewSource, val language: String) : TelemetryEvent {
    override val name = "android_file_viewed"
    override val properties get() = mapOf("source" to source.wire, "language" to language)
  }

  /** A file showed as a rendered preview rather than its source; [kind] is `markdown`, `pdf` or `image`. */
  data class PreviewOpened(val kind: FilePreviewKind) : TelemetryEvent {
    override val name = "android_preview_opened"
    override val properties get() = mapOf("kind" to kind.wire)
  }

  /** Once per diagram drawn (never a cached one); [failed] says Mermaid couldn't draw it. */
  data class MermaidRendered(val failed: Boolean) : TelemetryEvent {
    override val name = "android_mermaid_rendered"
    override val properties get() = mapOf("failed" to failed)
  }

  data class DesignOpened(val source: DesignSource) : TelemetryEvent {
    override val name = "android_design_opened"
    override val properties get() = mapOf("source" to source.wire)
  }

  data class DesignLayerSelected(val source: DesignSelectionSource) : TelemetryEvent {
    override val name = "android_design_layer_selected"
    override val properties get() = mapOf("source" to source.wire)
  }

  data class FileSearchRun(val regex: Boolean, val results: Int, val truncated: Boolean) : TelemetryEvent {
    override val name = "android_file_search_run"
    override val properties get() = mapOf("regex" to regex, "result_bucket" to resultBucket(results), "truncated" to truncated)
  }

  /** Once per settled term, never the term itself. */
  data class IssueSearched(val results: Int) : TelemetryEvent {
    override val name = "android_issue_searched"
    override val properties get() = mapOf("result_bucket" to resultBucket(results))
  }

  // Errors

  /** [message] is scrubbed and truncated here, before it can be sent. */
  data class AppError(val scope: String, val message: String) : TelemetryEvent {
    override val name = "android_app_error"
    override val properties get() = mapOf("scope" to scope, "message" to Telemetry.scrub(message).take(2000))
  }

  /** The computer is too old for something the phone asked; [method] is a protocol name. */
  data class HostFeatureUnsupported(val method: String) : TelemetryEvent {
    override val name = "android_host_feature_unsupported"
    override val properties get() = mapOf("method" to method)
  }

  /** Shared with the desktop and iPhone on purpose: the same consent signal. */
  data object TelemetryEnabled : TelemetryEvent {
    override val name = "telemetry_enabled"
  }

  data object TelemetryDisabled : TelemetryEvent {
    override val name = "telemetry_disabled"
  }

  // Account

  data class AccountSignedIn(val provider: SignInProvider, val firstDevice: Boolean) : TelemetryEvent {
    override val name = "android_account_signed_in"
    override val properties get() = mapOf("provider" to provider.wire, "first_device" to firstDevice)
  }

  data object AccountSignedOut : TelemetryEvent {
    override val name = "android_account_signed_out"
  }

  data class AccountMemberAuth(val outcome: MemberAuthOutcome) : TelemetryEvent {
    override val name = "android_account_member_auth"
    override val properties get() = mapOf("outcome" to outcome.wire)
  }

  data class AccountRemovedNotice(val action: NoticeAction) : TelemetryEvent {
    override val name = "android_account_removed_notice"
    override val properties get() = mapOf("action" to action.wire)
  }

  data class MemberRemoved(val role: MemberRole) : TelemetryEvent {
    override val name = "android_member_removed"
    override val properties get() = mapOf("role" to role.wire)
  }

  data class MemberRenamed(val role: MemberRole) : TelemetryEvent {
    override val name = "android_member_renamed"
    override val properties get() = mapOf("role" to role.wire)
  }

  data class ComputerAdded(val via: ComputerAddedVia) : TelemetryEvent {
    override val name = "android_computer_added"
    override val properties get() = mapOf("via" to via.wire)
  }

  data class JoinActed(val action: JoinAction, val role: JoinRole) : TelemetryEvent {
    override val name = "android_join_acted"
    override val properties get() = mapOf("action" to action.wire, "role" to role.wire)
  }

  data class DeviceNameChanged(val source: NameSource, val linked: Boolean) : TelemetryEvent {
    override val name = "android_device_name_changed"
    override val properties get() = mapOf("source" to source.wire, "linked" to linked)
  }

  data class AccountReset(val action: ResetAction) : TelemetryEvent {
    override val name = "android_account_reset"
    override val properties get() = mapOf("action" to action.wire)
  }

  /** Push registered with the account, so every computer on it can wake the phone. */
  data class AccountPushRegistered(val success: Boolean) : TelemetryEvent {
    override val name = "android_account_push_registered"
    override val properties get() = mapOf("success" to success)
  }

  /** A wake-up push from the account service was handled in the background. */
  data class AccountWoken(val reason: WakeReason, val outcome: WakeOutcome) : TelemetryEvent {
    override val name = "android_account_woken"
    override val properties get() = mapOf("reason" to reason.wire, "outcome" to outcome.wire)
  }

  // Prop values

  /** How a screen named by a route reached the phone. */
  enum class LinkSource(val wire: String) {
    Link("link"), Handoff("handoff"), Shortcut("shortcut"), Widget("widget"), Share("share"), Notification("notification"),
  }

  enum class ImageViewerAction(val wire: String) { Copy("copy"), Share("share") }

  enum class ProjectListSource(val wire: String) { Home("home"), Sidebar("sidebar") }

  enum class InboxFilterField(val wire: String) { Automation("automation"), Project("project"), Clear("clear") }

  enum class InputAffordance(val wire: String) {
    UsageLimits("usage_limits"), SlashCommand("slash_command"), Mention("mention"), ImagePaste("image_paste"),
    ImageAttach("image_attach"), FileAttach("file_attach"), SideAnswerSent("side_answer_sent"), Dictation("dictation"),
    OverflowMenu("overflow_menu"),
  }

  enum class Setting(val wire: String) { AutoExpandImageReads("auto_expand_image_reads") }

  enum class Appearance(val wire: String) { System("system"), Light("light"), Dark("dark") }

  /** A default that new work starts from. */
  enum class DefaultSetting(val wire: String) {
    PermissionMode("permission_mode"), Autonomy("autonomy"), WorktreeCleanupEnabled("worktree_cleanup_enabled"),
    WorktreeCleanupLandedDays("worktree_cleanup_landed_days"), WorktreeCleanupIdleDays("worktree_cleanup_idle_days"),
    WorktreeCleanupMaxSize("worktree_cleanup_max_size"),
  }

  enum class StartWorkspace(val wire: String) { Current("current"), Worktree("worktree"), Existing("existing") }

  /** `Unreachable`: cancelled with no computer reachable. */
  enum class ShareOutcome(val wire: String) { Started("started"), Cancelled("cancelled"), Unreachable("unreachable"), Unpaired("unpaired") }

  enum class ClearScope(val wire: String) { One("one"), All("all") }

  enum class SessionAction(val wire: String) {
    OpenDetails("open_details"), SwitchAgent("switch_agent"), CloseAgentTab("close_agent_tab"),
    NewAgentTab("new_agent_tab"), OpenPullRequest("open_pull_request"),
  }

  enum class HomeAction(val wire: String) {
    Usage("usage"), Inbox("inbox"), Agents("agents"), Automations("automations"), Session("session"), Project("project"),
  }

  enum class NewSessionSource(val wire: String) {
    Home("home"), Project("project"), ProjectRow("project_row"), Sidebar("sidebar"), Stack("stack"),
  }

  enum class BlueprintScreen(val wire: String) { List("list"), Editor("editor"), Generate("generate"), NewProject("new_project") }

  enum class MessageAction(val wire: String) { Copy("copy"), Edit("edit"), ForkSession("fork_session"), ForkAgent("fork_agent") }

  enum class MessageRole(val wire: String) { User("user"), Assistant("assistant") }

  enum class ChatHistoryAction(val wire: String) { Search("search"), Delete("delete") }

  enum class FileViewSource(val wire: String) {
    ChatLink("chat_link"), Changes("changes"), QuickOpen("quick_open"), Search("search"), Link("link"),
  }

  enum class DesignSource(val wire: String) { Issue("issue"), Session("session") }

  enum class DesignSelectionSource(val wire: String) { Canvas("canvas"), Tree("tree") }

  enum class SignInProvider(val wire: String) { Google("google"), Github("github"), Email("email") }

  enum class MemberAuthOutcome(val wire: String) {
    Removed("removed"), ClockSkew("clock_skew"), Refused("refused"), ClerkFallback("clerk_fallback"),
  }

  enum class NoticeAction(val wire: String) { SignIn("sign_in"), Dismiss("dismiss") }

  enum class MemberRole(val wire: String) { Device("device"), Host("host") }

  enum class ComputerAddedVia(val wire: String) { Code("code"), ExistingPairing("existing_pairing") }

  enum class JoinAction(val wire: String) { Requested("requested"), Approved("approved"), Denied("denied"), Expired("expired") }

  enum class JoinRole(val wire: String) { Subject("subject"), Approver("approver") }

  enum class NameSource(val wire: String) { Settings("settings"), AccountList("account_list") }

  enum class ResetAction(val wire: String) {
    Started("started"), Completed("completed"), Failed("failed"), Seen("seen"), SignInNeeded("sign_in_needed"),
  }

  enum class WakeReason(val wire: String) { Join("join"), Changed("changed") }

  enum class WakeOutcome(val wire: String) {
    Prompted("prompted"), Refreshed("refreshed"), Removed("removed"), Reset("reset"), Unreachable("unreachable"),
  }

  companion object {
    /** Message length as a bucket: the length itself is close enough to the content to round off. */
    fun lengthBucket(length: Int): String = when {
      length < 50 -> "xs"
      length < 200 -> "s"
      length < 1000 -> "m"
      length < 5000 -> "l"
      else -> "xl"
    }

    fun resultBucket(count: Int): String = when {
      count <= 0 -> "0"
      count <= 10 -> "1-10"
      count <= 100 -> "11-100"
      count <= 1000 -> "101-1000"
      else -> "1000+"
    }

    fun ageBucket(seconds: Long): String = when {
      seconds < 3600 -> "under_1h"
      seconds < 86_400 -> "under_1d"
      else -> "over_1d"
    }
  }
}

private val RemoteEndpoint.Kind.wire: String get() = name.lowercase()
