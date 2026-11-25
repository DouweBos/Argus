import ArgusKit
import Foundation

/// Clone Repository's states, for both galleries.
extension GalleryFixtures {
  public static let cloneJobId = "clone-tally"
  private static let cloneParent = "/Users/dev/Developer"

  private static var cloneDefaults: [String: Any] {
    [
      "parent_dir": cloneParent, "gh_available": true,
      "parents": [cloneParent, "/Users/dev/Projects", "/Users/dev/Work/Clients"],
    ]
  }

  private static func cloneJob(status: String, phase: String, percent: Double?, error: String?) -> [String: Any] {
    let now = Date().timeIntervalSince1970 * 1000
    return [
      "id": cloneJobId, "url": "https://github.com/houwert/tally.git", "url_kind": "https",
      "path": "\(cloneParent)/tally", "status": status, "phase": phase,
      "percent": percent as Any? ?? NSNull(), "error": error as Any? ?? NSNull(),
      "started_at": now - 14_000, "finished_at": status == "running" ? NSNull() : now,
    ]
  }

  private static func clone(_ jobs: [[String: Any]], problem: String? = nil) -> [String: String] {
    [
      "projects.clone_defaults": GalleryJSON.encode(cloneDefaults),
      "projects.clone_preview": GalleryJSON.encode([
        "url_kind": "https", "name": "tally", "path": "\(cloneParent)/tally",
        "problem": problem as Any? ?? NSNull(),
      ]),
      "projects.clones": GalleryJSON.encode(["clones": jobs]),
    ]
  }

  /// Nothing typed yet.
  public static var cloneIdle: [String: String] { clone([]) }

  /// An address typed whose folder already exists.
  public static var cloneTaken: [String: String] {
    clone([], problem: "tally already exists in /Users/dev/Developer.")
  }

  /// Receiving objects, part way.
  public static var cloneRunning: [String: String] {
    clone([cloneJob(status: "running", phase: "receiving", percent: 42, error: nil)])
  }

  /// Refused by the git host.
  public static var cloneFailed: [String: String] {
    clone([
      cloneJob(
        status: "failed", phase: "connecting", percent: nil,
        error: "Repository not found, or you don't have access to it.")
    ])
  }
}
