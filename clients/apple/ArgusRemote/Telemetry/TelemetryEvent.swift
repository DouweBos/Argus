import ArgusCore
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

  /// Where the design viewer was opened from.
  enum DesignSource: String {
    /// A Figma link in an issue.
    case issue
    /// One of a session's design frames.
    case session
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
    /// Not signed in, or the account service couldn't be reached.
    case unreachable
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
  case permissionAnswered(approved: Bool, fromNotification: Bool)
  case agentControlled(action: AgentAction)
  /// `strategy` is only meaningful for a merge — nil elsewhere.
  case workLanded(action: LandAction, success: Bool, strategy: String? = nil)
  case deviceWatched(durationMs: Int, interacted: Bool)
  case claudeAccountChanged(action: AccountAction)
  case automationEdited(action: AutomationAction)
  case runActed(action: RunAction)
  case proposalHandled(action: ProposalAction)
  case pullRequestActed(action: PullRequestAction)
  case branchActed(action: BranchAction)
  /// `target` says whether the session's display name or its branch moved.
  case sessionRenamed(target: String)
  case memoryEdited(action: MemoryAction)
  /// The inbox's shortcut into the run a proposal came out of.
  case proposalOpenedAsRun
  /// A suggested reply filled the message field.
  case followUpUsed
  case settingChanged(setting: Setting, enabled: Bool)
  /// A colour theme preset id.
  case colorThemeChanged(theme: String)
  /// `value` is the enum's raw value, or `computer` / `none` when cleared.
  case defaultChanged(setting: DefaultSetting, value: String)
  /// The start sheet sent its agent off. `workspace` is `current`, `worktree`
  /// or `existing`; `changedWorkspace` says it isn't the one the sheet opened on.
  case agentStartSubmitted(workspace: String, changedWorkspace: Bool)
  /// The warnings list was opened; `count` is how many it held.
  case warningsOpened(count: Int)
  /// A session file opened in the read-only viewer.
  case fileViewed(source: FileViewSource, language: String)
  /// A Figma frame opened in the design viewer.
  case designOpened(source: DesignSource)
  /// A worktree search finished; `results` is bucketed before it is sent.
  case fileSearchRun(regex: Bool, results: Int, truncated: Bool)
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
  /// The phone wrote a revoke for another member.
  case memberRemoved(role: MemberRole)
  /// The phone approved a computer's link; the host counts completion itself.
  case computerAdded(via: ComputerAddedVia)
  /// The phone asked to join, or approved or denied a device joining.
  case joinActed(action: JoinAction, role: JoinRole)
  /// The phone renamed a member of the account.
  case memberRenamed(role: MemberRole)
  /// This phone's name setting changed; `linked`: renamed on the account too.
  case deviceNameChanged(source: AccountStore.NameSource, linked: Bool)
  /// Push registered with the account (every computer on it can wake the phone), or it failed.
  case accountPushRegistered(success: Bool)
  /// A wake-up push from the account service was handled in the background.
  case accountWoken(reason: WakeReason, outcome: WakeOutcome)
  /// A live connection moved to a better route (e.g. tunnel → Wi-Fi) without dropping.
  case routeUpgraded(from: RemoteEndpoint.Kind, to: RemoteEndpoint.Kind)

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
    case .deviceWatched: "ios_device_watched"
    case .claudeAccountChanged: "ios_claude_account_changed"
    case .automationEdited: "ios_automation_edited"
    case .runActed: "ios_run_acted"
    case .proposalHandled: "ios_proposal_handled"
    case .pullRequestActed: "ios_pull_request_acted"
    case .branchActed: "ios_branch_acted"
    case .sessionRenamed: "ios_session_renamed"
    case .memoryEdited: "ios_memory_edited"
    case .proposalOpenedAsRun: "ios_proposal_opened"
    case .followUpUsed: "ios_follow_up_used"
    case .settingChanged: "ios_setting_changed"
    case .colorThemeChanged: "ios_color_theme_changed"
    case .defaultChanged: "ios_default_changed"
    case .agentStartSubmitted: "ios_agent_start_submitted"
    case .warningsOpened: "ios_warnings_opened"
    case .fileViewed: "ios_file_viewed"
    case .designOpened: "ios_design_opened"
    case .fileSearchRun: "ios_file_search_run"
    case .appError: "ios_app_error"
    case .hostFeatureUnsupported: "ios_host_feature_unsupported"
    case .telemetryEnabled: "telemetry_enabled"
    case .telemetryDisabled: "telemetry_disabled"
    case .accountSignedIn: "ios_account_signed_in"
    case .accountSignedOut: "ios_account_signed_out"
    case .memberRemoved: "ios_member_removed"
    case .computerAdded: "ios_computer_added"
    case .joinActed: "ios_join_acted"
    case .memberRenamed: "ios_member_renamed"
    case .deviceNameChanged: "ios_device_name_changed"
    case .accountPushRegistered: "ios_account_push_registered"
    case .accountWoken: "ios_account_woken"
    case .routeUpgraded: "ios_route_upgraded"
    }
  }

  var properties: [String: Any] {
    switch self {
    case .launched, .telemetryEnabled, .telemetryDisabled, .proposalOpenedAsRun, .followUpUsed,
      .accountSignedOut:
      [:]
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
    case .permissionAnswered(let approved, let fromNotification):
      ["approved": approved, "from_notification": fromNotification]
    case .agentControlled(let action):
      ["action": action.rawValue]
    case .workLanded(let action, let success, let strategy):
      [
        "action": action.rawValue, "success": success,
        "strategy": strategy ?? "none",
      ]
    case .deviceWatched(let durationMs, let interacted):
      ["duration_ms": durationMs, "interacted": interacted]
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
    case .settingChanged(let setting, let enabled):
      ["setting": setting.rawValue, "enabled": enabled]
    case .colorThemeChanged(let theme):
      ["theme": theme]
    case .defaultChanged(let setting, let value):
      ["setting": setting.rawValue, "value": value]
    case .agentStartSubmitted(let workspace, let changedWorkspace):
      ["workspace": workspace, "changed_workspace": changedWorkspace]
    case .warningsOpened(let count):
      ["count": count]
    case .fileViewed(let source, let language):
      ["source": source.rawValue, "language": language]
    case .designOpened(let source):
      ["source": source.rawValue]
    case .fileSearchRun(let regex, let results, let truncated):
      ["regex": regex, "result_bucket": Self.resultBucket(results), "truncated": truncated]
    case .appError(let scope, let message):
      ["scope": scope, "message": String(Telemetry.scrub(message).prefix(2000))]
    case .hostFeatureUnsupported(let method):
      ["method": method]
    case .routeUpgraded(let from, let to):
      ["from": from.rawValue, "to": to.rawValue]
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
  private static func bucket(_ length: Int) -> String {
    switch length {
    case ..<50: "xs"
    case ..<200: "s"
    case ..<1000: "m"
    case ..<5000: "l"
    default: "xl"
    }
  }
}
