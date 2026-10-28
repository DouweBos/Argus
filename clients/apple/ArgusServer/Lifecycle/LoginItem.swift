import Foundation
import ServiceManagement

/// How Argus Server starts at login: an `SMAppService` agent whose plist ships
/// in `Contents/Library/LaunchAgents` (written by the target's build phase).
/// Unlike `SMAppService.mainApp`, a launchd agent brings the app back after a
/// crash (`KeepAlive {SuccessfulExit: false}`); Quit exits 0, so it stays down.
enum LoginItemState: Equatable {
  case enabled
  case requiresApproval
  case off
  /// The agent plist isn't in the bundle (a build that skipped the phase).
  case unavailable

  var telemetry: ServerTelemetryEvent.LoginItemStatus {
    switch self {
    case .enabled: .enabled
    case .requiresApproval: .requiresApproval
    case .off, .unavailable: .off
    }
  }
}

@MainActor
struct LoginItem {
  /// `<bundle id>.agent`: Debug and Release register apart.
  let label: String

  init(bundleId: String = Bundle.main.bundleIdentifier ?? "dev.houwert.argus.server") {
    label = "\(bundleId).agent"
  }

  private var service: SMAppService { .agent(plistName: "\(label).plist") }

  var state: LoginItemState {
    switch service.status {
    case .enabled: .enabled
    case .requiresApproval: .requiresApproval
    case .notRegistered: .off
    case .notFound: .unavailable
    @unknown default: .off
    }
  }

  func setEnabled(_ on: Bool) throws {
    if on { try service.register() } else { try service.unregister() }
  }

  static func openSystemSettings() {
    SMAppService.openSystemSettingsLoginItems()
  }

  /// launchd names a job's process after its label.
  func launchedByLaunchd(environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
    environment["XPC_SERVICE_NAME"] == label
  }
}
