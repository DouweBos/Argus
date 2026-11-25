import ArgusKit
import Foundation

/// Slack as the computer has it connected, one entry per workspace. Tokens,
/// owners and allowlists decide who runs agents here, so only this Mac's own
/// host changes them.
extension HostStore {
  public typealias SlackStatus = ArgusProtocol.SlackStatus
  public typealias SlackChannel = ArgusProtocol.SlackChannel

  /// Every workspace the computer knows, connected or not.
  public var slackWorkspaces: [SlackStatus] { slackOverview?.workspaces ?? [] }

  /// Some workspace's tokens are saved, whether or not its socket is up right now.
  public var slackConfigured: Bool { slackWorkspaces.contains { $0.configured } }

  /// The Mac asks its own host, which includes the claim codes; a phone gets the redacted status.
  public func loadSlackStatus() async {
    guard let backend else { return }
    do {
      if backend.kind == .local {
        slackOverview = try await backend.request(ArgusProtocol.Commands.SlackStatus.self, EmptyParams())
      } else {
        let result = try await backend.request(ArgusProtocol.Methods.SlackStatus.self, .init())
        slackOverview = Self.overview(status: result.status, workspaces: result.workspaces)
      }
    } catch {
      // An older computer has no Slack to offer.
      slackOverview = nil
    }
  }

  /// A computer from before several workspaces sends only `status`, possibly one never connected.
  static func overview(status: SlackStatus, workspaces: [SlackStatus]?) -> ArgusProtocol.SlackOverview {
    let known = status.configured || status.workspace != nil
    return .init(workspaces: workspaces ?? (known ? [status] : []))
  }

  /// A Settings command answered with the new overview.
  public func applySlackOverview(_ overview: ArgusProtocol.SlackOverview) {
    slackOverview = overview
  }

  /// Every connected workspace's channels, for the Mac's pickers; empty elsewhere or when Slack is down.
  public func slackChannels() async -> [SlackChannel] {
    guard let backend, backend.kind == .local, slackConfigured else { return [] }
    return (try? await backend.request(ArgusProtocol.Commands.SlackListChannels.self, EmptyParams())) ?? []
  }

  /// A mapping's project as the computer names it, or the folder name when it's gone.
  public func projectName(repoRoot: String) -> String {
    projects.first { $0.repoRoot == repoRoot }?.name ?? URL(fileURLWithPath: repoRoot).lastPathComponent
  }
}
