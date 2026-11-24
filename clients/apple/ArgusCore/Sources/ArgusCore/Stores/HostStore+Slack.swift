import ArgusKit
import Foundation

/// Slack as the computer has it connected. Tokens, owner and allowlist decide
/// who runs agents here, so only this Mac's own host changes them.
extension HostStore {
  public typealias SlackStatus = ArgusProtocol.SlackStatus
  public typealias SlackChannel = ArgusProtocol.SlackChannel

  /// The bot's tokens are saved, whether or not the socket is up right now.
  public var slackConfigured: Bool { slackStatus?.configured == true }

  /// The Mac asks its own host, which includes the claim code; a phone gets the redacted status.
  public func loadSlackStatus() async {
    guard let backend else { return }
    do {
      slackStatus =
        backend.kind == .local
        ? try await backend.request(ArgusProtocol.Commands.SlackStatus.self, EmptyParams())
        : try await backend.request(ArgusProtocol.Methods.SlackStatus.self, .init()).status
    } catch {
      // An older computer has no Slack to offer.
      slackStatus = nil
    }
  }

  /// A Settings command answered with the new status.
  public func applySlackStatus(_ status: SlackStatus) {
    slackStatus = status
  }

  /// Channels the bot can see, for the Mac's pickers; empty elsewhere or when Slack is down.
  public func slackChannels() async -> [SlackChannel] {
    guard let backend, backend.kind == .local, slackConfigured else { return [] }
    return (try? await backend.request(ArgusProtocol.Commands.SlackListChannels.self, EmptyParams())) ?? []
  }

  /// A mapping's project as the computer names it, or the folder name when it's gone.
  public func projectName(repoRoot: String) -> String {
    projects.first { $0.repoRoot == repoRoot }?.name ?? URL(fileURLWithPath: repoRoot).lastPathComponent
  }
}
