import ArgusKit
import Foundation

/// Each paired host's last answers to its lists — projects, sessions, agents —
/// one file per host in the app's state folder, so a host that is down when
/// the app launches still shows its last projects, marked offline.
public struct HostSnapshotFiles: Sendable {
  public let directory: URL

  public init(directory: URL) {
    self.directory = directory
  }

  private func url(_ host: HostId) -> URL {
    let safe = host.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || $0 == "-" }
    return directory.appendingPathComponent("\(String(String.UnicodeScalarView(safe))).json")
  }

  /// Every host's snapshot: host → (cache key → answer).
  public func loadAll() -> [HostId: [String: JSONValue]] {
    let files = (try? FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: nil)) ?? []
    var result: [HostId: [String: JSONValue]] = [:]
    for file in files where file.pathExtension == "json" {
      guard let data = try? Data(contentsOf: file),
        let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data)
      else { continue }
      result[snapshot.host] = snapshot.answers
    }
    return result
  }

  public func save(_ answers: [String: JSONValue], for host: HostId) {
    do {
      try FileManager.default.createDirectory(
        at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      let data = try JSONEncoder().encode(Snapshot(host: host, answers: answers))
      try data.write(to: url(host), options: .atomic)
    } catch {
      NSLog("[argus] couldn't save the snapshot of a host: %@", "\(error)")
    }
  }

  public func remove(_ host: HostId) {
    try? FileManager.default.removeItem(at: url(host))
  }

  private struct Snapshot: Codable {
    let host: HostId
    let answers: [String: JSONValue]
  }
}
