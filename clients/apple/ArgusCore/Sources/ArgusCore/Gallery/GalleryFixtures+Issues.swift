import ArgusKit
import Foundation

/// A Linear issue and a connected Linear, for the start-from-issue stories on both platforms.
extension GalleryFixtures {
  public static var linearIssue: HostStore.LinearIssue {
    let json: [String: Any] = [
      "id": "iss-273", "identifier": "ENGAGE-273", "title": "Show a skeleton while the Watchlist tab first loads",
      "description": "", "url": "https://linear.app/acme/issue/ENGAGE-273",
      "branchName": "engage-273-watchlist-skeleton",
      "state": ["id": "st-todo", "name": "Todo", "type": "unstarted", "position": 1],
      "priority": 2, "teamId": "t-engage", "teamKey": "ENGAGE", "teamName": "Engage", "labels": ["iOS"],
      "pullRequestCount": 0, "createdAt": 1_762_000_000_000, "updatedAt": 1_762_800_000_000,
    ]
    return try! ProtocolCodec.decoder.decode(HostStore.LinearIssue.self, from: Data(GalleryJSON.encode(json).utf8))
  }

  /// `home` plus a connected Linear, so the issue chips and the Verify option show.
  public static var homeWithLinear: [String: String] {
    home.merging([
      RemoteMethod.integrationsList.rawValue: GalleryJSON.encode([
        "integrations": [["id": "linear", "connected": true, "needsReauth": false, "oauthAvailable": true]]
      ])
    ]) { _, new in new }
  }
}
