import ArgusKit
import Foundation

/// Connecting integrations from a paired device: the key or tokens go to the
/// computer's secret store over the encrypted channel and never come back.
extension HostStore {
  /// Throws the computer's own sentence, e.g. that the service rejected the key.
  public func connectIntegration(_ id: ArgusProtocol.IntegrationId, key: String) async throws {
    guard let backend else { return }
    let status = try await backend.request(
      ArgusProtocol.Methods.IntegrationsConnectKey.self,
      .init(id: id, key: key.trimmingCharacters(in: .whitespacesAndNewlines))
    ).integration
    applyIntegration(status)
  }

  public func disconnectIntegration(_ id: ArgusProtocol.IntegrationId) async throws {
    guard let backend else { return }
    let status = try await backend.request(ArgusProtocol.Methods.IntegrationsDisconnect.self, .init(id: id))
      .integration
    applyIntegration(status)
  }

  /// The manifest to create the Slack app from, for the clipboard.
  public func slackManifest() async throws -> String {
    guard let backend else { return "" }
    return try await backend.request(ArgusProtocol.Methods.SlackManifest.self, .init()).manifest
  }

  /// The answer carries the claim code, so the device that connected can claim the bot.
  public func connectSlack(botToken: String, appToken: String) async throws {
    guard let backend else { return }
    let result = try await backend.request(
      ArgusProtocol.Methods.SlackConnect.self,
      .init(
        botToken: botToken.trimmingCharacters(in: .whitespacesAndNewlines),
        appToken: appToken.trimmingCharacters(in: .whitespacesAndNewlines))
    )
    slackOverview = .init(workspaces: result.workspaces)
  }

  public func disconnectSlack(teamId: String) async throws {
    guard let backend else { return }
    let result = try await backend.request(ArgusProtocol.Methods.SlackDisconnect.self, .init(teamId: teamId))
    slackOverview = .init(workspaces: result.workspaces)
  }

  func applyIntegration(_ status: ArgusProtocol.IntegrationStatus) {
    if let index = integrations.firstIndex(where: { $0.id == status.id }) {
      integrations[index] = status
    } else {
      integrations.append(status)
    }
  }
}

/// The integrations a paired device can connect, one screen each.
public enum IntegrationKind: String, CaseIterable, Hashable, Sendable {
  case linear, figma, slack

  /// Linear and Figma take a key; Slack takes its own app's two tokens.
  public var keyIntegration: ArgusProtocol.IntegrationId? {
    switch self {
    case .linear: .linear
    case .figma: .figma
    case .slack: nil
    }
  }

  public var name: String {
    switch self {
    case .linear: "Linear"
    case .figma: "Figma"
    case .slack: "Slack"
    }
  }

  /// Where to create the key, as the Mac's Settings → Integrations says it.
  public var keyHelp: String {
    switch self {
    case .linear: "Create a personal API key in Linear under Settings → Account → Security & access."
    case .figma: "Create a personal access token in Figma under Settings → Security."
    case .slack: "Create the app from the manifest, install it, then paste its two tokens."
    }
  }
}
