import ArgusKit
import Foundation

/// A Slack workspace connected to a dozen projects, and the states before it is.
extension GalleryFixtures {
  private static let slackRoot = "/Users/dev/Projects/"

  private static func slackStatus(configured: Bool, claimed: Bool) -> [String: Any] {
    [
      "configured": configured,
      "state": configured ? "connected" : "off",
      "error": NSNull(),
      "workspace": configured ? "Northwind Studio" : NSNull(),
      "bot_name": configured ? "argus" : NSNull(),
      "owner": claimed ? ["user_id": "U04QX7M2K1", "name": "Sam Rivera"] : NSNull(),
      "claim_code": configured && !claimed ? "482913" : NSNull(),
      "default_project": claimed ? slackRoot + "Argus" : NSNull(),
      "mappings": claimed
        ? [
          ["channel_id": "C01", "channel_name": "ios-releases", "repo_root": slackRoot + "apple-client"],
          ["channel_id": "C02", "channel_name": "mobile-bugs", "repo_root": slackRoot + "react-native-client"],
          ["channel_id": "C03", "channel_name": "argus-dev", "repo_root": slackRoot + "Argus"],
          ["channel_id": "C04", "channel_name": "tv-web", "repo_root": slackRoot + "web-tv-client"],
        ] : [],
      "allowed_users": claimed
        ? [
          ["user_id": "U05HD3LMA8", "name": "Priya Natarajan"],
          ["user_id": "U06BZK41QE", "name": NSNull()],
        ] : [],
      "thread_count": claimed ? 7 : 0,
    ]
  }

  private static var slackChannels: [[String: Any]] { [
    ("C01", "ios-releases", true), ("C02", "mobile-bugs", true), ("C03", "argus-dev", true),
    ("C04", "tv-web", true), ("C05", "deploys", true), ("C06", "design-reviews", false),
    ("C07", "general", false),
  ].map { ["id": $0.0, "name": $0.1, "is_private": false, "is_member": $0.2] } }

  private static func slack(configured: Bool, claimed: Bool) -> [String: String] {
    let status = slackStatus(configured: configured, claimed: claimed)
    var redacted = status
    redacted["claim_code"] = NSNull()
    return [
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects),
      RemoteMethod.integrationsList.rawValue: GalleryJSON.encode([
        "integrations": [
          ["id": "linear", "connected": true, "needsReauth": false, "oauthAvailable": true,
           "account": ["name": "Sam Rivera", "workspace": "Northwind"]],
          ["id": "figma", "connected": false, "needsReauth": false, "oauthAvailable": false],
        ]
      ]),
      ArgusProtocol.Commands.SlackStatus.name: GalleryJSON.encode(status),
      RemoteMethod.slackStatus.rawValue: GalleryJSON.encode(["status": redacted]),
      ArgusProtocol.Commands.SlackListChannels.name: GalleryJSON.encode(slackChannels),
    ]
  }

  /// Connected and claimed: an owner, two more members, four channel projects.
  public static var slackConnected: [String: String] { slack(configured: true, claimed: true) }
  /// Tokens saved, nobody has sent the bot its code yet.
  public static var slackClaimPending: [String: String] { slack(configured: true, claimed: false) }
  public static var slackNotConnected: [String: String] { slack(configured: false, claimed: false) }
}
