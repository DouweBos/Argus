#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// The review guide in a session's git panel and on a pull request, plus its writing and failed states.
  enum ReviewGuideStories {
    private static let screen = CGSize(width: 1180, height: 720)
    private static let session = ReviewGuideTarget.session(id: GalleryGit.worktreeSessionId)

    static var all: [GalleryStory] {
      [
        GalleryStory(
          "git/review-guide", size: screen, chrome: true, fixtures: GalleryFixtures.reviewGuide(.ready), setup: seed
        ) {
          ReviewGuideScreen(target: session)
        },
        GalleryStory(
          "git/review-guide/pull-request", size: screen, chrome: true, fixtures: GalleryFixtures.reviewGuide(.ready),
          setup: seed
        ) {
          PullRequestDetailScreen(repo: "acme/luma", number: 482, showsGuide: true)
        },
        GalleryStory(
          "git/review-guide/generating", size: screen, fixtures: GalleryFixtures.reviewGuide(.generating), setup: attach
        ) {
          ReviewGuideScreen(target: session)
        },
        GalleryStory(
          "git/review-guide/failed", size: screen, fixtures: GalleryFixtures.reviewGuide(.failed), setup: attach
        ) {
          ReviewGuideScreen(target: session)
        },
      ]
    }

    @MainActor
    private static func attach(_ stage: GalleryStage) async {
      await stage.model.store.attach(stage.backend)
    }

    /// Two stops read and a draft on the first, so the list shows progress and counts.
    @MainActor
    private static func seed(_ stage: GalleryStage) async {
      await attach(stage)
      let store = stage.model.store
      for target in [session, ReviewGuideTarget.pullRequest(repo: "acme/luma", number: 482, headSha: nil)] {
        store.markStopVisited(target, stop: "s3")
        store.reviews.clear(target.key)
        store.reviews.add(
          DiffReviewComment(
            path: "src/session/merge.ts", side: .new, lines: 18...18, excerpt: ["  if (!branch) {"], hunk: "",
            scope: target.scope, body: "Throw a string: handlers surface string errors."),
          sessionId: target.key)
      }
    }
  }
#endif
