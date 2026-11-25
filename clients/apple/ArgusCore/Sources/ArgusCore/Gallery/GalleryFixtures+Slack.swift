import ArgusKit
import Foundation

/// Two Slack workspaces connected to a dozen projects, and the states before them.
extension GalleryFixtures {
  private static let slackRoot = "/Users/dev/Projects/"

  private static func slackStatus(
    team: String = "T01NWS", workspace: String = "Northwind Studio", configured: Bool, claimed: Bool
  ) -> [String: Any] {
    [
      "team_id": team,
      "configured": configured,
      "state": configured ? "connected" : "off",
      "error": NSNull(),
      "workspace": workspace,
      "bot_name": "argus-sam",
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
      "app": ["id": "A07NWS2K9Q", "name": "Argus (Sam)"],
    ]
  }

  /// The client team's workspace, connected beside the studio's own.
  private static var clientWorkspace: [String: Any] {
    var status = slackStatus(team: "T02CLT", workspace: "Contoso Retail", configured: true, claimed: true)
    status["mappings"] = [["channel_id": "C11", "channel_name": "app-feedback", "repo_root": slackRoot + "apple-client"]]
    status["default_project"] = slackRoot + "apple-client"
    status["allowed_users"] = []
    status["thread_count"] = 2
    return status
  }

  private static var slackChannels: [[String: Any]] {
    [
      ("C01", "ios-releases", true), ("C02", "mobile-bugs", true), ("C03", "argus-dev", true),
      ("C04", "tv-web", true), ("C05", "deploys", true), ("C06", "design-reviews", false),
      ("C07", "general", false),
    ].map {
      ["id": $0.0, "team_id": "T01NWS", "workspace": "Northwind Studio", "name": $0.1, "is_private": false,
       "is_member": $0.2]
    }
  }

  private static func slack(workspaces: [[String: Any]], pendingApp: Bool = false) -> [String: String] {
    let redacted = workspaces.map { status -> [String: Any] in
      var copy = status
      copy["claim_code"] = NSNull()
      return copy
    }
    return [
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects),
      RemoteMethod.integrationsList.rawValue: GalleryJSON.encode([
        "integrations": [
          ["id": "linear", "connected": true, "needsReauth": false, "oauthAvailable": true,
           "account": ["name": "Sam Rivera", "workspace": "Northwind"]],
          ["id": "figma", "connected": false, "needsReauth": false, "oauthAvailable": false],
        ]
      ]),
      ArgusProtocol.Commands.SlackStatus.name: GalleryJSON.encode([
        "workspaces": workspaces,
        "pending_app": pendingApp ? ["id": "A07NWS2K9Q", "name": "Argus (Sam)"] as Any : NSNull(),
      ]),
      RemoteMethod.slackStatus.rawValue: GalleryJSON.encode([
        "status": redacted.first ?? slackStatus(configured: false, claimed: false),
        "workspaces": redacted,
      ]),
      ArgusProtocol.Commands.SlackListChannels.name: GalleryJSON.encode(slackChannels),
    ]
  }

  /// Connected and claimed: an owner, two more members, four channel projects.
  public static var slackConnected: [String: String] {
    slack(workspaces: [slackStatus(configured: true, claimed: true)])
  }
  /// The studio's workspace and a client's, each with its own projects.
  public static var slackTwoWorkspaces: [String: String] {
    slack(workspaces: [slackStatus(configured: true, claimed: true), clientWorkspace])
  }
  /// Tokens saved, nobody has sent the bot its code yet.
  public static var slackClaimPending: [String: String] {
    slack(workspaces: [slackStatus(configured: true, claimed: false)])
  }
  /// Tokens deleted; the workspace's owner and projects kept for a reconnect.
  public static var slackDisconnected: [String: String] {
    slack(workspaces: [slackStatus(configured: false, claimed: true), clientWorkspace])
  }
  public static var slackNotConnected: [String: String] { slack(workspaces: []) }
  /// Argus created the app; its two tokens still to paste.
  public static var slackAppCreated: [String: String] { slack(workspaces: [], pendingApp: true) }
}
