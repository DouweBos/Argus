#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI
  import UIKit

  /// The share extension's pickers. iOS only: the Mac has no share sheet into Argus.
  enum ShareStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("share/projects", fixtures: projects) {
          ShareProjectList(
            summary: ShareSummary(images: [screenshot], hasLink: true), computers: computers,
            selectedId: computers[0].id, onSelect: { _ in }, onRetry: {}
          )
          .navigationTitle("Send to Argus")
          .inlineNavigationTitle()
        },
        GalleryStory("share/sessions", fixtures: sessions) {
          ShareSessionList(repoRoot: "/Users/dev/Projects/Argus") { _ in }
            .inlineNavigationTitle()
        },
      ]
    }

    private static let computers = [
      ShareComputer(id: "studio", label: "Mac Studio"), ShareComputer(id: "air", label: "MacBook Air"),
    ]

    private static var projects: [String: String] {
      [RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects)]
    }

    private static var sessions: [String: String] {
      let rows: [[String: Any]] = [
        session("root", "main", kind: "project_root"),
        session("share-sheet", "Share extension for screenshots"),
        session("pr-watch", "Watch pull request tool"),
        session("flaky", "Fix flaky merge test", status: "error"),
        session("gallery", "Gallery stories for sessions", status: "initializing"),
        session("onboarding", "Explore onboarding copy"),
      ]
      return [
        RemoteMethod.projectsList.rawValue: GalleryJSON.projects(["Argus"]),
        RemoteMethod.sessionsList.rawValue: GalleryJSON.encode(["sessions": rows]),
      ]
    }

    private static func session(
      _ id: String, _ name: String, kind: String = "worktree", status: String = "ready"
    ) -> [String: Any] {
      [
        "id": id, "repo_root": "/Users/dev/Projects/Argus", "kind": kind, "branch": id,
        "display_name": name, "status": status,
      ]
    }

    /// A stand-in for a screenshot: a phone-shaped frame with a few content bars.
    private static var screenshot: PendingImage {
      let size = CGSize(width: 390, height: 844)
      let image = UIGraphicsImageRenderer(size: size).image { context in
        UIColor.secondarySystemBackground.setFill()
        context.fill(CGRect(origin: .zero, size: size))
        UIColor.systemGray3.setFill()
        for row in 0..<6 {
          context.fill(CGRect(x: 24, y: 120 + row * 110, width: row.isMultiple(of: 2) ? 342 : 220, height: 64))
        }
      }
      return ImageAttachments.pending(image: image)!
    }
  }
#endif
