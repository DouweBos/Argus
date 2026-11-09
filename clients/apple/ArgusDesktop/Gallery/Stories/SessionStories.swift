#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Sidebar session rows with a pull request in each state, watched and not.
  enum SessionStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("sessions/sidebar-rows/pull-requests", size: CGSize(width: 280, height: 0)) {
          VStack(alignment: .leading, spacing: 1) {
            ForEach(rows, id: \.id) { session in
              SessionRow(session: session, agents: [])
                .padding(.horizontal, 8)
            }
          }
          .padding(8)
        }
      ]
    }

    private static let rows: [RemoteSession] = [
      session("watched", "Watch pull request tool", pr: (412, "open"), watched: true),
      session("open", "Fix flaky merge test", pr: (409, "open")),
      session("draft", "Gallery stories for sessions", pr: (415, "draft"), watched: true),
      session("merged", "Linear issue picker", pr: (398, "merged")),
      session("closed", "Try a new sidebar layout", pr: (377, "closed")),
      session("none", "Explore onboarding copy", pr: nil),
    ]

    private static func session(
      _ id: String, _ name: String, pr: (Int, String)?, watched: Bool = false
    ) -> RemoteSession {
      var json: [String: Any] = [
        "id": id, "repo_root": "/Users/dev/Projects/Argus", "kind": "worktree",
        "branch": id, "display_name": name, "status": "ready",
      ]
      if let pr {
        json["pull_request"] = [
          "number": pr.0, "state": pr.1, "url": "https://github.com/acme/argus/pull/\(pr.0)",
        ]
        json["pull_request_watched"] = watched
      }
      return try! ProtocolCodec.decoder.decode(RemoteSession.self, from: Data(GalleryJSON.encode(json).utf8))
    }
  }
#endif
