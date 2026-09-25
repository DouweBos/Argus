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
  case workLanded(action: LandAction, success: Bool)
  case deviceWatched(durationMs: Int, interacted: Bool)
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
    case .appError: "ios_app_error"
    case .telemetryEnabled: "telemetry_enabled"
    case .telemetryDisabled: "telemetry_disabled"
    }
  }

  var properties: [String: Any] {
    switch self {
    case .launched, .telemetryEnabled, .telemetryDisabled:
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
    case .workLanded(let action, let success):
      ["action": action.rawValue, "success": success]
    case .deviceWatched(let durationMs, let interacted):
      ["duration_ms": durationMs, "interacted": interacted]
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
