import Foundation
import ServiceManagement

public enum LoginItemState: Equatable, Sendable {
  case enabled
  case requiresApproval
  case off
  /// The agent plist isn't in the bundle (a build that skipped the phase).
  case unavailable
}

/// Open at Login through `SMAppService`, one of two ways:
/// - `agent`: Argus Server. A launchd agent whose plist ships in
///   `Contents/Library/LaunchAgents` (`Tools/embed-login-agent.sh`), labelled
///   `<bundle id>.agent`; it brings the app back after a crash
///   (`KeepAlive {SuccessfulExit: false}`), and Quit exits 0 so it stays down.
/// - `mainApp`: the Mac app. A plain login item: an IDE that crashed shouldn't
///   relaunch itself, and there's no plist to collide with the server's.
@MainActor
public struct LoginItem {
  public enum Kind: Sendable {
    case agent(label: String)
    case mainApp
  }

  public let kind: Kind

  /// The server's agent: Debug and Release register apart.
  public init(bundleId: String = Bundle.main.bundleIdentifier ?? "dev.houwert.argus.server") {
    kind = .agent(label: "\(bundleId).agent")
  }

  public init(kind: Kind) {
    self.kind = kind
  }

  public static var mainApp: LoginItem { LoginItem(kind: .mainApp) }

  /// The launchd label; nil for a plain login item.
  public var label: String? {
    if case .agent(let label) = kind { label } else { nil }
  }

  private var service: SMAppService {
    switch kind {
    case .agent(let label): .agent(plistName: "\(label).plist")
    case .mainApp: .mainApp
    }
  }

  public var state: LoginItemState {
    switch service.status {
    case .enabled: .enabled
    case .requiresApproval: .requiresApproval
    case .notRegistered: .off
    case .notFound: .unavailable
    @unknown default: .off
    }
  }

  public func setEnabled(_ on: Bool) throws {
    if on { try service.register() } else { try service.unregister() }
  }

  public static func openSystemSettings() {
    SMAppService.openSystemSettingsLoginItems()
  }

  /// launchd names a job's process after its label.
  public func launchedByLaunchd(environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
    guard let label else { return false }
    return environment["XPC_SERVICE_NAME"] == label
  }
}
