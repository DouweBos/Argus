import Foundation

/// Every event the Mac app sends itself — the Swift analogue of
/// `packages/host/src/telemetryEvents.ts`, so the wrong props don't compile.
///
/// The host already captures what it does on the app's behalf (`agent_started`,
/// `session_created`, …), so only what the host cannot see is here: the app's
/// own lifecycle, the supervisor, the host-lock handover, and navigation.
enum MacTelemetryEvent {
  enum Holder: String {
    case electron
    case mac
    case cli
  }

  case launched
  case quit(hadRunningAgents: Bool)
  case hostStarted(restarts: Int)
  case hostCrashed(exitCode: Int, attempt: Int)
  case hostFailed(crashes: Int)
  case hostLockConflict(holder: Holder)
  case hostHandover(holder: Holder, success: Bool)
  /// `screen` is a route pattern, never an id.
  case screenViewed(screen: String)

  var name: String {
    switch self {
    case .launched: "mac_launched"
    case .quit: "mac_quit"
    case .hostStarted: "mac_host_started"
    case .hostCrashed: "mac_host_crashed"
    case .hostFailed: "mac_host_failed"
    case .hostLockConflict: "mac_host_lock_conflict"
    case .hostHandover: "mac_host_handover"
    case .screenViewed: "mac_screen_viewed"
    }
  }

  var properties: [String: Any] {
    switch self {
    case .launched:
      [:]
    case .quit(let hadRunningAgents):
      ["had_running_agents": hadRunningAgents]
    case .hostStarted(let restarts):
      ["restarts": restarts]
    case .hostCrashed(let exitCode, let attempt):
      ["exit_code": exitCode, "attempt": attempt]
    case .hostFailed(let crashes):
      ["crashes": crashes]
    case .hostLockConflict(let holder):
      ["holder": holder.rawValue]
    case .hostHandover(let holder, let success):
      ["holder": holder.rawValue, "success": success]
    case .screenViewed(let screen):
      ["screen": screen]
    }
  }
}
