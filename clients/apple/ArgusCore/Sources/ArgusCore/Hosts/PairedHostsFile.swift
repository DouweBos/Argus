import ArgusKit
import Foundation

/// The hosts this Mac can drive and which of them it attaches on launch,
/// kept in a file only this user can read — the desktop keeps the same keys
/// in its `localStorage`.
public struct PairedHostsFile: Sendable {
  public struct Contents: Codable, Equatable, Sendable {
    public var hosts: [DeviceIdentity]
    public var attached: [HostId]

    public init(hosts: [DeviceIdentity] = [], attached: [HostId] = []) {
      self.hosts = hosts
      self.attached = attached
    }
  }

  public let url: URL

  public init(url: URL) {
    self.url = url
  }

  public func load() -> Contents {
    guard let data = try? Data(contentsOf: url),
      let contents = try? JSONDecoder().decode(Contents.self, from: data)
    else { return Contents() }
    return contents
  }

  public func save(_ contents: Contents) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let data = try JSONEncoder().encode(contents)
    // Created 0600 before the keys go in, not chmod-ed after.
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(
        atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
    }
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.truncate(atOffset: 0)
    try handle.write(contentsOf: data)
  }
}
