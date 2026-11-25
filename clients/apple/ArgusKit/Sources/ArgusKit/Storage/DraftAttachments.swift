import Foundation

/// A composer draft's attachments (images, picked elements), one JSON file
/// per agent and kind, so they survive a switch away or a relaunch like its text.
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
    load(RemoteImageAttachment.self, agentId: agentId)
  }

  /// No attachments removes the agent's file.
  public func save(_ attachments: [RemoteImageAttachment], agentId: String) {
    save(attachments, agentId: agentId, kind: nil)
  }

  public func remove(agentId: String) {
    remove(agentId: agentId, kind: nil)
  }

  /// `kind` keeps another attachment type in its own file; nil is the images'.
  public func load<T: Decodable>(_ type: T.Type, agentId: String, kind: String? = nil) -> [T] {
    guard let data = try? Data(contentsOf: file(agentId, kind)) else { return [] }
    return (try? JSONDecoder().decode([T].self, from: data)) ?? []
  }

  public func save<T: Encodable>(_ items: [T], agentId: String, kind: String?) {
    guard !items.isEmpty else { return remove(agentId: agentId, kind: kind) }
    guard let data = try? JSONEncoder().encode(items) else { return }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try? data.write(to: file(agentId, kind), options: .atomic)
  }

  public func remove(agentId: String, kind: String?) {
    try? FileManager.default.removeItem(at: file(agentId, kind))
  }

  private func file(_ agentId: String, _ kind: String?) -> URL {
    let name = agentId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? agentId
    return directory.appendingPathComponent(kind.map { "\(name).\($0).json" } ?? "\(name).json")
  }
}
