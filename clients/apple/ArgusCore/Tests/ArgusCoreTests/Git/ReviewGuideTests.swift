import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Review guide")
struct ReviewGuideTests {
  private static let session = ReviewGuideTarget.session(id: "s-1")

  private func store(_ fixture: GalleryFixtures.ReviewGuideFixture) async -> HostStore {
    let store = HostStore()
    await store.attach(GalleryBackend(GalleryFixtures.reviewGuide(fixture)))
    await store.loadReviewGuide(Self.session)
    return store
  }

  @Test("a ready guide decodes, and a stop's files keep only the hunks it points at")
  func stopFilesFollowRanges() async throws {
    let store = await store(.ready)
    let guide = try #require(store.reviewGuides.state(Self.session)?.guide)
    #expect(guide.stops.map(\.id) == ["s1", "s2", "s3", "s4"])
    let files = store.reviewGuides.files(Self.session, stop: guide.stops[0])
    #expect(files.map(\.displayPath) == ["src/session/merge.ts"])
    // Lines 10-22 of merge.ts sit in its second hunk only.
    #expect(files.first?.hunks.count == 1)
    #expect(files.first?.hunks.first?.header.hasPrefix("@@ -8,11 +9,14 @@") == true)
    // A stop with no ranges shows its files whole.
    #expect(store.reviewGuides.files(Self.session, stop: guide.stops[3]).first?.hunks.count == 1)
  }

  @Test("reading every stop completes the guide once")
  func visiting() async throws {
    let store = await store(.ready)
    for stop in ["s1", "s2", "s1", "s3", "s4"] { store.markStopVisited(Self.session, stop: stop) }
    #expect(store.reviewGuides.visited(Self.session) == ["s1", "s2", "s3", "s4"])
  }

  @Test("a failed guide carries the host's reason")
  func failed() async {
    let store = await store(.failed)
    #expect(store.reviewGuides.state(Self.session)?.status == .failed)
    #expect(store.reviewGuides.state(Self.session)?.error?.contains("signed in") == true)
  }

  @Test("a pull request's drafts are kept apart from any session's")
  func keys() {
    #expect(ReviewGuideTarget.session(id: "abc").key == "abc")
    #expect(ReviewGuideTarget.pullRequest(repo: "acme/luma", number: 482, headSha: "f00").key == "pr:acme/luma#482")
  }

  @Test("drafts become GitHub inline comments: removed lines on the left, a range with a start line")
  func wireComments() {
    let removed = DiffReviewComment(
      path: "a.ts", side: .old, lines: 3...3, excerpt: ["x"], hunk: "", scope: "pull request #1", body: "Why?")
    let range = DiffReviewComment(
      path: "a.ts", side: .new, lines: 10...12, excerpt: ["y"], hunk: "", scope: "pull request #1", body: "Split.")
    let left = PullRequestReviewComments.wire(removed)
    let right = PullRequestReviewComments.wire(range)
    #expect(left.side == .lEFT && left.line == 3 && left.startLine == nil)
    #expect(right.side == .rIGHT && right.line == 12 && right.startLine == 10)
  }

  @Test("guide routes round-trip through their paths")
  func routes() {
    for route in [ArgusRoute.pullRequestGuide(repo: "acme/luma", number: 482), .sessionGit(id: "s-1", view: .guide)] {
      #expect(ArgusRoute(path: route.path) == route)
    }
    #expect(ArgusRoute.pullRequestGuide(repo: "acme/luma", number: 482).pattern == "/pull-requests/:owner/:repo/:number/guide")
  }
}
