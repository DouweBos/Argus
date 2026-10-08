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
  case settingChanged(setting: Setting, enabled: Bool)
  /// `value` is the enum's raw value, or `computer` / `none` when cleared.
  case defaultChanged(setting: DefaultSetting, value: String)
  /// The warnings list was opened; `count` is how many it held.
  case warningsOpened(count: Int)
  /// A session file opened in the read-only viewer.
  case fileViewed(source: FileViewSource, language: String)
  /// A worktree search finished; `results` is bucketed before it is sent.
  case fileSearchRun(regex: Bool, results: Int, truncated: Bool)
  /// `message` is scrubbed and truncated by `Telemetry` before it is sent.
  case appError(scope: String, message: String)
  /// Shared with the desktop on purpose: it is the same consent signal.
  case telemetryEnabled
  case telemetryDisabled

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
    case .settingChanged: "ios_setting_changed"
    case .defaultChanged: "ios_default_changed"
    case .warningsOpened: "ios_warnings_opened"
    case .fileViewed: "ios_file_viewed"
    case .fileSearchRun: "ios_file_search_run"
    case .appError: "ios_app_error"
    case .telemetryEnabled: "telemetry_enabled"
    case .telemetryDisabled: "telemetry_disabled"
    }
  }

  var properties: [String: Any] {
    switch self {
    case .launched, .telemetryEnabled, .telemetryDisabled, .proposalOpenedAsRun:
      [:]
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
    case .defaultChanged(let setting, let value):
      ["setting": setting.rawValue, "value": value]
    case .warningsOpened(let count):
      ["count": count]
    case .fileViewed(let source, let language):
      ["source": source.rawValue, "language": language]
    case .fileSearchRun(let regex, let results, let truncated):
      ["regex": regex, "result_bucket": Self.resultBucket(results), "truncated": truncated]
    case .appError(let scope, let message):
      ["scope": scope, "message": String(Telemetry.scrub(message).prefix(2000))]
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
