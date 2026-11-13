import ArgusCore
import ArgusUI
import Foundation

/// Every event this client sends, with its props attached to the case — the
/// Swift analogue of `packages/host/src/telemetryEvents.ts`, and the same
/// guarantee: the wrong props don't compile.
///
/// Scope is deliberately narrow. The computer already captures
/// `session_created`, `agent_started`, `session_merged` and friends when this
/// app asks it to, so anything the host can see is missing here on purpose —
/// re-sending it would inflate those funnels twice over.
enum TelemetryEvent {
  /// What can be done to a running agent from the phone.
  typealias AgentAction = StoreEvent.AgentAction

  /// What was done to the Claude accounts this computer has signed in.
  typealias AccountAction = StoreEvent.AccountAction

  /// What happened to an automation's memory.
  typealias MemoryAction = StoreEvent.MemoryAction
  typealias DiffReviewAction = StoreEvent.DiffReviewAction

  /// What was done to an automation's definition.
  typealias AutomationAction = StoreEvent.AutomationAction

  /// What was done to a run.
  typealias RunAction = StoreEvent.RunAction

  /// How an inbox proposal was answered.
  typealias ProposalAction = StoreEvent.ProposalAction

  /// What was done to a pull request.
  typealias PullRequestAction = StoreEvent.PullRequestAction

  /// What was done to a branch.
  typealias BranchAction = StoreEvent.BranchAction

  /// What happened to a reply written while offline.
  typealias OfflineReplyAction = StoreEvent.OfflineReplyAction

  /// Where the design viewer was opened from.
  enum DesignSource: String {
    /// A Figma link in an issue.
    case issue
    /// One of a session's design frames.
    case session
  }

  /// How a screen named by a route reached the phone.
  enum LinkSource: String {
    case link
    case handoff
    /// Siri, the Shortcuts app or an App Shortcut.
    case shortcut
    case spotlight
    /// A Home Screen or Lock Screen widget.
    case widget
    /// The Control Center control.
    case control
    /// A row on the agents' Live Activity.
    case liveActivity = "live_activity"

    init(_ source: WidgetLink.Source) {
      switch source {
      case .widget: self = .widget
      case .control: self = .control
      case .liveActivity: self = .liveActivity
      }
    }
  }

  enum LiveActivityAction: String {
    case started
    /// Approve or Deny was tapped on it.
    case answered
    /// Switched off in Settings.
    case disabled
  }

  /// An App Intent, run from Siri, Shortcuts or Spotlight.
  enum IntentKind: String {
    case startAgent = "start_agent"
    case sendMessage = "send_message"
    case approveRequest = "approve_request"
    case agentsNeedingMe = "agents_needing_me"
    case runAutomation = "run_automation"
    case openSession = "open_session"
  }

  enum Setting: String {
    case autoExpandImageReads = "auto_expand_image_reads"
  }

  /// A default that new work starts from.
  enum DefaultSetting: String {
    /// Phone-local: the mode new agents started here begin in.
    case permissionMode = "permission_mode"
    /// The computer's cap on how far any automation may go.
    case autonomy
  }

  /// How work leaves a session.
  typealias LandAction = StoreEvent.LandAction

  /// How this phone signed in to its Argus account.
  typealias SignInProvider = AccountSignInProvider

  /// Whether a member this phone took off the account was a device or a computer.
  typealias MemberRole = AccountMember.Role

  /// This phone's side of a device approval: what happened, and whether it
  /// was the device joining or the one approving.
  typealias JoinAction = AccountStore.JoinAction
  typealias JoinRole = AccountStore.JoinRole

  /// Why the account service woke the phone.
  enum WakeReason: String {
    /// A device or computer asked to join.
    case join
    /// Someone was added to or removed from the account.
    case changed
  }

  /// What a wake-up push led to.
  enum WakeOutcome: String {
    /// A join request was announced with a notification.
    case prompted
    /// Re-read the account; nothing to show.
    case refreshed
    /// This phone had been removed from the account.
    case removed
    /// The account was reset from another device; this phone asks to join again.
    case reset
    /// Not signed in, or the account service couldn't be reached.
    case unreachable
  }

  /// What a message's long-press menu did.
  enum MessageAction: String {
    case copy
    case edit
    case forkSession = "fork_session"
    case forkAgent = "fork_agent"
  }

  enum MessageRole: String {
    case user
    case assistant
  }

  /// What was done in a session's saved chats.
  enum ClearScope: String {
    case one, all
  }

  enum ChatHistoryAction: String {
    case search
    case delete
  }

  /// What was done on a session screen that the computer never sees.
  enum SessionAction: String {
    /// The session details sheet was opened.
    case openDetails = "open_details"
    /// Another agent's tab was picked.
    case switchAgent = "switch_agent"
    /// A stopped agent's tab was closed.
    case closeAgentTab = "close_agent_tab"
    /// A "New agent" tab was opened, from the tab strip's `+` or the details.
    case newAgentTab = "new_agent_tab"
    /// The session's pull request was opened from its details.
    case openPullRequest = "open_pull_request"
  }

  /// Where the New Session composer was opened from.
  enum NewSessionSource: String {
    /// Home's compose button, on the last active project.
    case home
    /// A project screen's `+`.
    case project
    /// A project row's swipe action or menu on Home.
    case projectRow = "project_row"
    /// A project's `+` in the iPad sidebar.
    case sidebar
  }

  /// What was done with the iPad session's side panel.
  enum SessionPanelAction: String {
    case open, close
    /// Another tab was picked while it was open.
    case switchTab = "switch_tab"
  }

  /// Which of Home's links into another screen was followed.
  enum HomeAction: String {
    case usage, inbox, agents, automations
  }

  /// Where adding a computer to the account started.
  enum ComputerAddedVia: String {
    /// A link code typed into the phone.
    case code
    /// A computer this phone was QR-paired with, asked over the gateway.
    case existingPairing = "existing_pairing"
  }

  case launched
  case paired(endpointKind: String, hasControl: Bool)
  /// The `PairingError` case name only — never its detail.
  case pairFailed(reason: String)
  case hostSwitched(hostCount: Int)
  case messageSent(queued: Bool, hasImages: Bool, length: Int)
  case messageSendFailed(retried: Bool)
  case permissionAnswered(approved: Bool, alwaysAllow: Bool, fromNotification: Bool)
  case agentControlled(action: AgentAction)
  /// `strategy` is only meaningful for a merge — nil elsewhere.
  case workLanded(action: LandAction, success: Bool, strategy: String? = nil)
  case commitComposed(hasDescription: Bool, signOff: Bool, signed: Bool)
  case deviceWatched(durationMs: Int, interacted: Bool)
  /// The image on screen in the viewer was copied or its share sheet opened.
  case imageViewerUsed(action: ImageViewerOverlay.Action)
  case claudeAccountChanged(action: AccountAction)
  case automationEdited(action: AutomationAction)
  case runActed(action: RunAction)
  case proposalHandled(action: ProposalAction)
  case pullRequestActed(action: PullRequestAction)
  case branchActed(action: BranchAction)
  /// `target` says whether the session's display name or its branch moved.
  case sessionRenamed(target: String)
  case memoryEdited(action: MemoryAction)
  /// A diff review comment was added or deleted, the review sent or discarded, or an agent asked to review.
  case diffReviewed(action: DiffReviewAction, comments: Int)
  case diffScoped(scope: StoreEvent.DiffScopeKind)
  case reviewGuideUsed(action: StoreEvent.ReviewGuideAction, stops: Int)
  /// The computer was out of reach and the phone showed what it had saved; `age` in seconds.
  case savedShown(age: TimeInterval)
  case offlineReply(action: OfflineReplyAction)
  /// The inbox's shortcut into the run a proposal came out of.
  case proposalOpenedAsRun
  /// A suggested reply filled the message field.
  case followUpUsed
  /// A message-field feature the host can't see; follow-ups have their own event.
  case inputUsed(affordance: String)
  case settingChanged(setting: Setting, enabled: Bool)
  /// A colour theme preset id.
  case colorThemeChanged(theme: String)
  /// `system`, `light` or `dark`.
  case appearanceChanged(appearance: String)
  /// `value` is the enum's raw value, or `computer` / `none` when cleared.
  case defaultChanged(setting: DefaultSetting, value: String)
  /// The start sheet sent its agent off. `workspace` is `current`, `worktree`
  /// or `existing`; `changedWorkspace` says it isn't the one the sheet opened on.
  case agentStartSubmitted(
    workspace: String, changedWorkspace: Bool, hasImages: Bool, effortSet: Bool, changedProject: Bool)
  /// A share into Argus ended. `outcome` is `started`, `cancelled`, `unreachable`
  /// (cancelled with no computer reachable) or `unpaired`; `workspace` is where it started, else `none`.
  case shareFinished(outcome: String, hasImages: Bool, hasLink: Bool, hasText: Bool, workspace: String)
  /// The warnings list was opened; `count` is how many it held.
  case warningsOpened(count: Int)
  /// One notification was swiped away, or the whole list cleared.
  case notificationsCleared(scope: ClearScope)
  /// An agent's MCP servers list was opened.
  case mcpServersOpened
  /// The session screen's details were opened, or its agent tabs used.
  case sessionUsed(action: SessionAction)
  /// The iPad session side panel was opened, closed or switched; `tab` is the one in front after.
  case sessionPanelUsed(action: SessionPanelAction, tab: SessionPanelTab)
  /// A section link on Home was followed, to measure what Home leads people to.
  case homeUsed(action: HomeAction)
  /// The New Session composer was opened, to measure which way in people use.
  case newSessionOpened(source: NewSessionSource)
  /// A turn's folded work was opened in a chat; `working` says the agent was still on it.
  case transcriptWorkLogOpened(working: Bool)
  /// A message's menu was used; `success` says the host took the edit or fork (always true for copy).
  case messageAction(action: MessageAction, role: MessageRole, success: Bool)
  /// A session's saved chats were searched (first keystroke) or one was deleted.
  case chatHistoryUsed(action: ChatHistoryAction)
  /// A session file opened in the read-only viewer.
  case fileViewed(source: FileViewSource, language: String)
  /// A Figma frame opened in the design viewer.
  case designOpened(source: DesignSource)
  /// The first layer picked in a design viewer frame, on its render or in its layer list.
  case designLayerSelected(source: DesignViewerModel.SelectionSource)
  /// A worktree search finished; `results` is bucketed before it is sent.
  case fileSearchRun(regex: Bool, results: Int, truncated: Bool)
  /// A workspace issue search settled; once per term, never the term itself.
  case issueSearched(results: Int)
  /// `message` is scrubbed and truncated by `Telemetry` before it is sent.
  case appError(scope: String, message: String)
  /// The computer is too old for something the phone asked; `method` is a protocol name.
  case hostFeatureUnsupported(method: String)
  /// Shared with the desktop on purpose: it is the same consent signal.
  case telemetryEnabled
  case telemetryDisabled
  /// Signed in and the account is ready; `firstDevice` when this phone wrote its genesis.
  case accountSignedIn(provider: SignInProvider, firstDevice: Bool)
  case accountSignedOut
  /// Signing a request with the phone's member key didn't simply work.
  case accountMemberAuth(outcome: AccountStore.MemberAuthOutcome)
  /// The app-wide "removed from your account" notice: Join again, or dismissed.
  case accountRemovedNotice(action: AccountStore.NoticeAction)
  /// The phone wrote a revoke for another member.
  case memberRemoved(role: MemberRole)
  /// The phone approved a computer's link; the host counts completion itself.
  case computerAdded(via: ComputerAddedVia)
  /// The phone asked to join, or approved or denied a device joining.
  case joinActed(action: JoinAction, role: JoinRole)
  /// The phone renamed a member of the account.
  case memberRenamed(role: MemberRole)
  /// Starting the account over from this phone, or noticing it was started over elsewhere.
  case accountReset(action: ResetAction)
  /// This phone's name setting changed; `linked`: renamed on the account too.
  case deviceNameChanged(source: AccountStore.NameSource, linked: Bool)
  /// Push registered with the account (every computer on it can wake the phone), or it failed.
  case accountPushRegistered(success: Bool)
  /// A wake-up push from the account service was handled in the background.
  case accountWoken(reason: WakeReason, outcome: WakeOutcome)
  /// A live connection moved to a better route (e.g. tunnel → Wi-Fi) without dropping.
  case routeUpgraded(from: RemoteEndpoint.Kind, to: RemoteEndpoint.Kind)
  /// An `argus://` link or a Handoff opened a screen; `screen` is its route pattern,
  /// `fallback` that the phone has no such screen and opened its parent.
  case linkOpened(screen: String, via: LinkSource, fallback: Bool)
  /// An App Intent finished; `success` false when it threw or found nothing to act on.
  case intentRun(intent: IntentKind, success: Bool)
  /// Once a launch: how many of each widget and control are placed, to see whether they are used.
  case widgetsInstalled(agents: Int, inbox: Int, usage: Int, controls: Int)
  /// The agents' Live Activity started, was answered from, or was switched off.
  case liveActivity(action: LiveActivityAction)

  var name: String {
    switch self {
    case .launched: "ios_launched"
    case .paired: "ios_paired"
    case .pairFailed: "ios_pair_failed"
    case .hostSwitched: "ios_host_switched"
    case .messageSent: "ios_message_sent"
    case .messageSendFailed: "ios_message_send_failed"
    case .permissionAnswered: "ios_permission_answered"
    case .agentControlled: "ios_agent_controlled"
    case .workLanded: "ios_work_landed"
    case .commitComposed: "ios_commit_composed"
    case .deviceWatched: "ios_device_watched"
    case .imageViewerUsed: "ios_image_viewer_used"
    case .claudeAccountChanged: "ios_claude_account_changed"
    case .automationEdited: "ios_automation_edited"
    case .runActed: "ios_run_acted"
    case .proposalHandled: "ios_proposal_handled"
    case .pullRequestActed: "ios_pull_request_acted"
    case .branchActed: "ios_branch_acted"
    case .sessionRenamed: "ios_session_renamed"
    case .memoryEdited: "ios_memory_edited"
    case .diffReviewed: "ios_diff_reviewed"
    case .diffScoped: "ios_diff_scope_changed"
    case .reviewGuideUsed: "ios_review_guide_used"
    case .savedShown: "ios_saved_shown"
    case .offlineReply: "ios_offline_reply"
    case .proposalOpenedAsRun: "ios_proposal_opened"
    case .followUpUsed: "ios_follow_up_used"
    case .inputUsed: "ios_input_used"
    case .settingChanged: "ios_setting_changed"
    case .colorThemeChanged: "ios_color_theme_changed"
    case .appearanceChanged: "ios_appearance_changed"
    case .defaultChanged: "ios_default_changed"
    case .agentStartSubmitted: "ios_agent_start_submitted"
    case .shareFinished: "ios_share_finished"
    case .warningsOpened: "ios_warnings_opened"
    case .notificationsCleared: "ios_notifications_cleared"
    case .mcpServersOpened: "ios_mcp_servers_opened"
    case .sessionUsed: "ios_session_used"
    case .sessionPanelUsed: "ios_session_panel_used"
    case .homeUsed: "ios_home_used"
    case .newSessionOpened: "ios_new_session_opened"
    case .transcriptWorkLogOpened: "ios_transcript_work_log_opened"
    case .messageAction: "ios_message_action"
    case .chatHistoryUsed: "ios_chat_history_used"
    case .fileViewed: "ios_file_viewed"
    case .designOpened: "ios_design_opened"
    case .designLayerSelected: "ios_design_layer_selected"
    case .fileSearchRun: "ios_file_search_run"
    case .issueSearched: "ios_issue_searched"
    case .appError: "ios_app_error"
    case .hostFeatureUnsupported: "ios_host_feature_unsupported"
    case .telemetryEnabled: "telemetry_enabled"
    case .telemetryDisabled: "telemetry_disabled"
    case .accountSignedIn: "ios_account_signed_in"
    case .accountSignedOut: "ios_account_signed_out"
    case .accountMemberAuth: "ios_account_member_auth"
    case .accountRemovedNotice: "ios_account_removed_notice"
    case .memberRemoved: "ios_member_removed"
    case .computerAdded: "ios_computer_added"
    case .joinActed: "ios_join_acted"
    case .memberRenamed: "ios_member_renamed"
    case .deviceNameChanged: "ios_device_name_changed"
    case .accountPushRegistered: "ios_account_push_registered"
    case .accountWoken: "ios_account_woken"
    case .accountReset: "ios_account_reset"
    case .routeUpgraded: "ios_route_upgraded"
    case .linkOpened: "ios_link_opened"
    case .intentRun: "ios_intent_run"
    case .widgetsInstalled: "ios_widgets_installed"
    case .liveActivity: "ios_live_activity"
    }
  }

  var properties: [String: Any] {
    switch self {
    case .launched, .telemetryEnabled, .telemetryDisabled, .proposalOpenedAsRun, .followUpUsed,
      .accountSignedOut, .mcpServersOpened:
      [:]
    case .accountMemberAuth(let outcome):
      ["outcome": outcome.rawValue]
    case .accountRemovedNotice(let action):
      ["action": action.rawValue]
    case .accountSignedIn(let provider, let firstDevice):
      ["provider": provider.rawValue, "first_device": firstDevice]
    case .memberRemoved(let role), .memberRenamed(let role):
      ["role": role.rawValue]
    case .joinActed(let action, let role):
      ["action": action.rawValue, "role": role.rawValue]
    case .deviceNameChanged(let source, let linked):
      ["source": source.rawValue, "linked": linked]
    case .computerAdded(let via):
      ["via": via.rawValue]
    case .accountPushRegistered(let success):
      ["success": success]
    case .accountWoken(let reason, let outcome):
      ["reason": reason.rawValue, "outcome": outcome.rawValue]
    case .accountReset(let action):
      ["action": action.rawValue]
    case .paired(let endpointKind, let hasControl):
      ["endpoint_kind": endpointKind, "has_control": hasControl]
    case .pairFailed(let reason):
      ["reason": reason]
    case .hostSwitched(let hostCount):
      ["host_count": hostCount]
    case .messageSent(let queued, let hasImages, let length):
      ["queued": queued, "has_images": hasImages, "length_bucket": Self.bucket(length)]
    case .messageSendFailed(let retried):
      ["retried": retried]
    case .permissionAnswered(let approved, let alwaysAllow, let fromNotification):
      ["approved": approved, "always_allow": alwaysAllow, "from_notification": fromNotification]
    case .agentControlled(let action):
      ["action": action.rawValue]
    case .workLanded(let action, let success, let strategy):
      [
        "action": action.rawValue, "success": success,
        "strategy": strategy ?? "none",
      ]
    case .commitComposed(let hasDescription, let signOff, let signed):
      ["has_description": hasDescription, "sign_off": signOff, "signed": signed]
    case .deviceWatched(let durationMs, let interacted):
      ["duration_ms": durationMs, "interacted": interacted]
    case .imageViewerUsed(let action):
      ["action": action.rawValue]
    case .claudeAccountChanged(let action):
      ["action": action.rawValue]
    case .automationEdited(let action):
      ["action": action.rawValue]
    case .runActed(let action):
      ["action": action.rawValue]
    case .proposalHandled(let action):
      ["action": action.rawValue]
    case .pullRequestActed(let action):
      ["action": action.rawValue]
    case .branchActed(let action):
      ["action": action.rawValue]
    case .sessionRenamed(let target):
      ["target": target]
    case .memoryEdited(let action):
      ["action": action.rawValue]
    case .diffReviewed(let action, let comments):
      ["action": action.rawValue, "comment_count": comments]
    case .diffScoped(let scope):
      ["scope": scope.rawValue]
    case .reviewGuideUsed(let action, let stops):
      ["action": action.rawValue, "stop_count": stops]
    case .savedShown(let age):
      ["age_bucket": Self.ageBucket(age)]
    case .offlineReply(let action):
      ["action": action.rawValue]
    case .settingChanged(let setting, let enabled):
      ["setting": setting.rawValue, "enabled": enabled]
    case .colorThemeChanged(let theme):
      ["theme": theme]
    case .inputUsed(let affordance):
      ["affordance": affordance]
    case .appearanceChanged(let appearance):
      ["appearance": appearance]
    case .defaultChanged(let setting, let value):
      ["setting": setting.rawValue, "value": value]
    case .agentStartSubmitted(let workspace, let changedWorkspace, let hasImages, let effortSet, let changedProject):
      [
        "workspace": workspace, "changed_workspace": changedWorkspace, "has_images": hasImages,
        "effort_set": effortSet, "changed_project": changedProject,
      ]
    case .shareFinished(let outcome, let hasImages, let hasLink, let hasText, let workspace):
      [
        "outcome": outcome, "has_images": hasImages, "has_link": hasLink, "has_text": hasText,
        "workspace": workspace,
      ]
    case .warningsOpened(let count):
      ["count": count]
    case .notificationsCleared(let scope):
      ["scope": scope.rawValue]
    case .transcriptWorkLogOpened(let working):
      ["working": working]
    case .messageAction(let action, let role, let success):
      ["action": action.rawValue, "role": role.rawValue, "success": success]
    case .chatHistoryUsed(let action):
      ["action": action.rawValue]
    case .sessionUsed(let action):
      ["action": action.rawValue]
    case .sessionPanelUsed(let action, let tab):
      ["action": action.rawValue, "tab": tab.rawValue]
    case .newSessionOpened(let source):
      ["source": source.rawValue]
    case .homeUsed(let action):
      ["action": action.rawValue]
    case .fileViewed(let source, let language):
      ["source": source.rawValue, "language": language]
    case .designOpened(let source):
      ["source": source.rawValue]
    case .designLayerSelected(let source):
      ["source": source.rawValue]
    case .fileSearchRun(let regex, let results, let truncated):
      ["regex": regex, "result_bucket": Self.resultBucket(results), "truncated": truncated]
    case .issueSearched(let results):
      ["result_bucket": Self.resultBucket(results)]
    case .appError(let scope, let message):
      ["scope": scope, "message": String(Telemetry.scrub(message).prefix(2000))]
    case .hostFeatureUnsupported(let method):
      ["method": method]
    case .routeUpgraded(let from, let to):
      ["from": from.rawValue, "to": to.rawValue]
    case .linkOpened(let screen, let via, let fallback):
      ["screen": screen, "via": via.rawValue, "fallback": fallback]
    case .intentRun(let intent, let success):
      ["intent": intent.rawValue, "success": success]
    case .widgetsInstalled(let agents, let inbox, let usage, let controls):
      ["agents": agents, "inbox": inbox, "usage": usage, "controls": controls]
    case .liveActivity(let action):
      ["action": action.rawValue]
    }
  }

  private static func resultBucket(_ count: Int) -> String {
    switch count {
    case 0: "0"
    case ...10: "1-10"
    case ...100: "11-100"
    case ...1000: "101-1000"
    default: "1000+"
    }
  }

  /// Message length as a bucket — the length itself is close enough to the
  /// content to be worth rounding off.
  private static func ageBucket(_ seconds: TimeInterval) -> String {
    switch seconds {
    case ..<3600: "under_1h"
    case ..<86_400: "under_1d"
    default: "over_1d"
    }
  }

  private static func bucket(_ length: Int) -> String {
    switch length {
    case ..<50: "xs"
    case ..<200: "s"
    case ..<1000: "m"
    case ..<5000: "l"
    default: "xl"
    }
  }

  /// The start composer's send, against the workspace it opened on.
  static func agentStartSubmitted(
    _ sent: StartComposerSheet.Submission, openedOn opened: StartWorkspace.Kind
  ) -> TelemetryEvent {
    .agentStartSubmitted(
      workspace: sent.workspace.rawValue, changedWorkspace: sent.workspace != opened, hasImages: sent.hasImages,
      effortSet: sent.effortSet, changedProject: sent.changedProject)
  }
}
