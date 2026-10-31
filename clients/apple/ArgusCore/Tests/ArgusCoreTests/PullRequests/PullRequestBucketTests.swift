import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func pr(
  _ number: Int, reasons: [String], review: String? = nil, draft: Bool = false, updated: String = "2026-01-01T00:00:00Z"
) -> RemotePullRequest {
  var json: [String: Any] = [
    "number": number, "title": "PR \(number)", "repo": "o/r", "repo_root": "/r", "is_draft": draft,
    "head_ref": "h", "base_ref": "main", "url": "https://x", "updated_at": updated, "reasons": reasons,
  ]
  json["review_decision"] = review
  return try! JSONDecoder().decode(RemotePullRequest.self, from: JSONSerialization.data(withJSONObject: json))
}

@Suite("Pull request buckets")
struct PullRequestBucketTests {
  @Test("a review request waits on me until approved; drafts beat review states")
  func buckets() {
    #expect(PullRequestBucket(pr(1, reasons: ["reviewer"])) == .awaitingMe)
    #expect(PullRequestBucket(pr(1, reasons: ["team"], draft: true)) == .awaitingMe)
    #expect(PullRequestBucket(pr(1, reasons: ["reviewer"], review: "APPROVED")) == .approved)
    #expect(PullRequestBucket(pr(1, reasons: ["author"], review: "CHANGES_REQUESTED", draft: true)) == .draft)
    #expect(PullRequestBucket(pr(1, reasons: ["author"], review: "CHANGES_REQUESTED")) == .changesRequested)
    #expect(PullRequestBucket(pr(1, reasons: ["author"])) == .awaitingOthers)
    #expect(PullRequestBucket(pr(1, reasons: ["mentioned"])) == .other)
  }

  @Test("buckets in display order, direct requests before team ones, then newest first")
  func grouping() {
    let groups = PullRequestBucket.group([
      pr(1, reasons: ["author"]),
      pr(2, reasons: ["team"], updated: "2026-03-01T00:00:00Z"),
      pr(3, reasons: ["reviewer"], updated: "2026-01-01T00:00:00Z"),
      pr(4, reasons: ["reviewer"], updated: "2026-02-01T00:00:00Z"),
    ])
    #expect(groups.map(\.bucket) == [.awaitingMe, .awaitingOthers])
    #expect(groups[0].prs.map(\.number) == [4, 3, 2])
    #expect(groups.contains { $0.bucket.needsAttention })
  }
}
