import ArgusKit
import Foundation

/// A review guide over the gallery's working diff, plus one being written and one that failed.
extension GalleryFixtures {
  public enum ReviewGuideFixture { case ready, generating, failed }

  private static var guideStops: [[String: Any]] {
    [
      [
        "id": "s1", "title": "Merges follow the project's strategy", "mechanical": false,
        "summary":
          "`merge` stops computing a merge base and asks the project settings for a strategy instead, then passes it to `git.merge`. This is the change the rest of the branch exists for.",
        "paths": ["src/session/merge.ts"],
        "ranges": [["path": "src/session/merge.ts", "side": "new", "start": 10, "end": 22]],
        "look_closely": [
          [
            "note": "The already-merged check is gone: merging a branch that's already in its base now runs a merge instead of returning early.",
            "path": "src/session/merge.ts", "line": 17,
          ],
          ["note": "An empty branch now throws an `Error`; command handlers elsewhere throw strings.", "path": "src/session/merge.ts", "line": 18],
        ],
      ],
      [
        "id": "s2", "title": "A test pins the default", "mechanical": false,
        "summary": "One test checks that squash is the default strategy. Nothing covers a project that sets its own.",
        "paths": ["src/session/strategy.test.ts"],
        "ranges": [["path": "src/session/strategy.test.ts", "side": "new", "start": 1, "end": 8]],
        "look_closely": [["note": "Is one default test enough, or should `merge` itself be tested with a strategy?", "path": NSNull(), "line": NSNull()]],
      ],
      [
        "id": "s3", "title": "The Electron bridge goes", "mechanical": true,
        "summary": "`src/legacy/bridge.ts` had no callers left.",
        "paths": ["src/legacy/bridge.ts"], "ranges": [], "look_closely": [],
      ],
      [
        "id": "s4", "title": "README", "mechanical": true, "summary": "How to run the dev server.",
        "paths": ["README.md"], "ranges": [], "look_closely": [],
      ],
    ]
  }

  public static func reviewGuideState(_ fixture: ReviewGuideFixture) -> [String: Any] {
    let guide: [String: Any] = [
      "head_sha": "be0f64aa5da08bb03468cd5b4597dee33a4282d2", "base_ref": "main",
      "overview":
        "Merging a session now uses the project's merge strategy (squash unless it says otherwise) instead of a merge base. Two smaller cleanups ride along.",
      "stops": guideStops, "generated_at": ISO8601DateFormatter().string(from: Date()),
    ]
    switch fixture {
    case .ready:
      return [
        "status": "ready", "guide": guide, "stale": false, "error": NSNull(), "started_at": NSNull(),
        "patch": GalleryGit.workingDiff,
      ]
    case .generating:
      return [
        "status": "generating", "guide": NSNull(), "stale": false, "error": NSNull(),
        "started_at": ISO8601DateFormatter().string(from: Date()), "patch": NSNull(),
      ]
    case .failed:
      return [
        "status": "failed", "guide": NSNull(), "stale": false,
        "error": "Claude couldn't write the guide. Check that `claude` is signed in, then try again.",
        "started_at": NSNull(), "patch": NSNull(),
      ]
    }
  }

  /// `review_guides.get` answering with `fixture`, on top of the pull request fixtures.
  public static func reviewGuide(_ fixture: ReviewGuideFixture) -> [String: String] {
    pullRequests.merging([
      RemoteMethod.reviewGuidesGet.rawValue: GalleryJSON.encode(["guide": reviewGuideState(fixture)])
    ]) { _, guide in guide }
  }
}
