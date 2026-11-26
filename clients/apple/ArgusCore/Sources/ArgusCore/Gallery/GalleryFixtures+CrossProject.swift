import ArgusKit
import Foundation

/// A cross-project session: luma's worktree spanning Argus and conductor on the
/// same branch, one linked repo with its pull request merged and one still setting up.
extension GalleryFixtures {
  public static let crossProjectRepoRoots = [root("Argus"), root("conductor")]

  /// `git(sessionId:path:)`, with the worktree session spanning two more repositories.
  public static func crossProjectGit(sessionId: String, path: String = GalleryGit.repoRoot) -> [String: String] {
    var fixtures = git(sessionId: sessionId, path: path)
    var primary = gitSession(sessionId, path: path)
    primary["linked_repos"] = [
      ["session_id": "xp-argus", "repo_root": root("Argus"), "branch": GalleryGit.branch],
      ["session_id": "xp-conductor", "repo_root": root("conductor"), "branch": GalleryGit.branch],
    ]
    fixtures[RemoteMethod.sessionsList.rawValue] = GalleryJSON.encode(["sessions": [primary]])
    let linked: [(String, String, String, (Int, String)?)] = [
      ("xp-argus", "Argus", "ready", (431, "merged")),
      ("xp-conductor", "conductor", "initializing", nil),
    ]
    for (id, repo, status, pr) in linked {
      let member = session(
        id, repo: repo, branch: GalleryGit.branch, name: "Merge strategy", status: status, pr: pr,
        extra: ["cross_project_of": sessionId])
      fixtures["\(RemoteMethod.sessionsList.rawValue)?repo_root=\(root(repo))"] = GalleryJSON.encode([
        "sessions": [member]
      ])
    }
    return fixtures
  }

  /// A composer's fixtures with an Argus worktree session that links react-native-client and conductor.
  public static var crossProjectOffer: [String: String] {
    composer.merging([
      "\(RemoteMethod.sessionsList.rawValue)?repo_root=\(argusRoot)": GalleryJSON.encode([
        "sessions": [session("s-xp", branch: "shared-auth-tokens", name: "Share auth tokens with the app")]
      ])
    ]) { _, new in new }
  }

  public static let crossProjectOfferSession = "s-xp"
  public static var crossProjectOfferLinked: [String] { [root("react-native-client"), root("conductor")] }

  /// Every repository the cross-project fixtures list, loaded into the store.
  @MainActor
  public static func loadCrossProject(_ host: HostStore) async {
    for repoRoot in [GalleryGit.repoRoot] + crossProjectRepoRoots { await host.loadSessions(repoRoot: repoRoot) }
  }
}
