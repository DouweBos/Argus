import Foundation

/// The images waiting in an agent's composer, kept beside its text draft
/// (`PreferenceKey.draft`) so they survive switching away and relaunching.
/// One file per agent: base64 images are too big for defaults.
public struct DraftAttachments: Sendable {
  private let directory: URL

  public init(directory: URL? = nil) {
    self.directory = directory ?? Self.defaultDirectory
  }

  /// Application Support, under the bundle id, as defaults are kept per bundle.
  private static var defaultDirectory: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    return base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Argus", isDirectory: true)
      .appendingPathComponent("ComposerDrafts", isDirectory: true)
  }

  public func load(agentId: String) -> [RemoteImageAttachment] {
    guard let data = try? Data(contentsOf: file(agentId)) else { return [] }
    return (try? JSONDecoder().decode([RemoteImageAttachment].self, from: data)) ?? []
  }

  /// No attachments removes the agent's file.
  public func save(_ attachments: [RemoteImageAttachment], agentId: String) {
    guard !attachments.isEmpty else { return remove(agentId: agentId) }
    guard let data = try? JSONEncoder().encode(attachments) else { return }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? data.write(to: file(agentId), options: .atomic)
  }

  public func remove(agentId: String) {
    try? FileManager.default.removeItem(at: file(agentId))
  }

  private func file(_ agentId: String) -> URL {
    let name = agentId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? agentId
    return directory.appendingPathComponent("\(name).json")
  }
}
