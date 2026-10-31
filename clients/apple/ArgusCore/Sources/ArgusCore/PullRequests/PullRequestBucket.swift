import Foundation

/// Where a PR sits in the list, as Electron's `pullRequestBucket.ts` sorts
/// them: what needs you first, the quiet ones after.
public enum PullRequestBucket: CaseIterable, Identifiable, Sendable {
  case awaitingMe, changesRequested, awaitingOthers, approved, draft, other

  public var id: Self { self }

  public var title: String {
    switch self {
    case .awaitingMe: "Awaiting my review"
    case .changesRequested: "Changes requested"
    case .awaitingOthers: "Awaiting another review"
    case .approved: "Approved"
    case .draft: "Draft"
    case .other: "Other"
    }
  }

  public var needsAttention: Bool { [.awaitingMe, .changesRequested, .approved].contains(self) }

  public init(_ pr: RemotePullRequest) {
    let reviewer = pr.reasons.contains("reviewer") || pr.reasons.contains("team")
    if reviewer && pr.reviewDecision != "APPROVED" {
      self = .awaitingMe
    } else if pr.isDraft {
      self = .draft
    } else if pr.reviewDecision == "CHANGES_REQUESTED" {
      self = .changesRequested
    } else if pr.reviewDecision == "APPROVED" {
      self = .approved
    } else if pr.reasons.contains("author") {
      self = .awaitingOthers
    } else {
      self = .other
    }
  }

  /// Buckets in display order, each newest first; direct review requests
  /// ahead of team ones.
  public static func group(_ prs: [RemotePullRequest]) -> [(bucket: PullRequestBucket, prs: [RemotePullRequest])] {
    let grouped = Dictionary(grouping: prs, by: PullRequestBucket.init)
    return allCases.compactMap { bucket in
      guard var list = grouped[bucket], !list.isEmpty else { return nil }
      list.sort { a, b in
        if bucket == .awaitingMe, a.reasons.contains("reviewer") != b.reasons.contains("reviewer") {
          return a.reasons.contains("reviewer")
        }
        return a.updatedAt > b.updatedAt
      }
      return (bucket, list)
    }
  }
}
