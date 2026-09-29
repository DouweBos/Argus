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
  enum AgentAction: String {
    case interrupt
    case stop
    case model
    case effort
    case permissionMode = "permission_mode"
  }

  /// What was done to the Claude accounts this computer has signed in.
  enum AccountAction: String {
    case select
    case add
    case remove
    case rename
    /// A session pinned to one account from the chat input.
    case pin
  }

  /// What happened to an automation's memory.
  enum MemoryAction: String {
    case save
    case delete
  }

  /// What was done to an automation's definition.
  enum AutomationAction: String {
    case create
    case save
    case delete
    case enable
    case disable
    case revisePlaybook = "revise_playbook"
  }

  /// What was done to a run.
  enum RunAction: String {
    case start
    case startScratch = "start_scratch"
    case cancel
    case feedback
    case saveScratch = "save_scratch"
  }

  /// How an inbox proposal was answered.
  enum ProposalAction: String {
    case accept
    case dismiss
    case resolve
    case cleanup
  }

  /// What was done to a pull request.
  enum PullRequestAction: String {
    case open
    case merge
    case comment
  }

  /// What was done to a branch.
  enum BranchAction: String {
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
  enum LandAction: String {
    case commit
    case push
    case merge
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
    case .appError(let scope, let message):
      ["scope": scope, "message": String(Telemetry.scrub(message).prefix(2000))]
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
