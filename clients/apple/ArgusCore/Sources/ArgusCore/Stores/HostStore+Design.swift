import ArgusKit
import Foundation

/// Figma frames as the computer's connected Figma user sees them, and
/// comparing one against a device the computer runs.
extension HostStore {
  public typealias FigmaFrameDetails = ArgusProtocol.FigmaFrameDetails
  public typealias DesignComparison = ArgusProtocol.DesignComparison

  /// Figma is connected and its key still works.
  public var figmaConnected: Bool {
    integrations.contains { $0.id == .figma && $0.connected && !$0.needsReauth }
  }

  /// Nil when the link isn't a frame Figma could render.
  public func figmaFrameDetails(url: String) async throws -> FigmaFrameDetails? {
    guard let backend else { return nil }
    return try await backend.request(ArgusProtocol.Methods.FigmaFrameDetails.self, .init(url: url)).details
  }

  public func compareDesign(url: String, platform: RemotePlatform, deviceKey: String) async throws
    -> DesignComparison?
  {
    guard let backend else { return nil }
    return try await backend.request(
      ArgusProtocol.Methods.DesignCompare.self,
      .init(url: url, platform: .init(rawValue: platform.rawValue), deviceKey: deviceKey)
    ).comparison
  }

  /// A session by id, across every loaded project.
  public func loadedSession(id: String) -> RemoteSession? {
    sessionsByRepo.values.joined().first { $0.id == id }
  }
}
