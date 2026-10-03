import ArgusUI
import Foundation

/// Where a PR sits in the list, as Electron's `pullRequestBucket.ts` sorts
/// them: what needs you first, the quiet ones after.
enum PullRequestBucket: CaseIterable, Identifiable {
  case awaitingMe, changesRequested, awaitingOthers, approved, draft, other

  var id: Self { self }

  var title: String {
    switch self {
    case .awaitingMe: "Awaiting my review"
    case .changesRequested: "Changes requested"
    case .awaitingOthers: "Awaiting another review"
    case .approved: "Approved"
    case .draft: "Draft"
    case .other: "Other"
    }
  }

  var needsAttention: Bool { [.awaitingMe, .changesRequested, .approved].contains(self) }

  init(_ pr: RemotePullRequest) {
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
  static func group(_ prs: [RemotePullRequest]) -> [(bucket: PullRequestBucket, prs: [RemotePullRequest])] {
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

enum PullRequestLabels {
  static func reason(_ raw: String) -> String {
    switch raw {
    case "author": "Author"
    case "reviewer": "Reviewer"
    case "team": "Team review"
    case "commenter": "Commented"
    case "mentioned": "Mentioned"
    default: raw.capitalized
    }
  }

  static func reasonTone(_ raw: String) -> Tone {
    switch raw {
    case "author": .accent
    case "reviewer", "team": .success
    default: .muted
    }
  }

  static func review(_ decision: String) -> (label: String, tone: Tone)? {
    switch decision {
    case "APPROVED": ("Approved", .success)
    case "CHANGES_REQUESTED": ("Changes requested", .danger)
    case "REVIEW_REQUIRED": ("Review required", .warning)
    default: nil
    }
  }

  static func relative(_ iso: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let date else { return iso }
    return date.formatted(.relative(presentation: .named))
  }

  /// `gh` missing or signed out is the usual failure; say how to fix it.
  static func explain(_ error: String) -> String {
    let lower = error.lowercased()
    if lower.contains("enoent") || lower.contains("not found") && lower.contains("gh") {
      return "The GitHub CLI (gh) is required. Install it and run `gh auth login`, then try again."
    }
    if lower.contains("auth login") || lower.contains("not logged") || lower.contains("authenticat") {
      return "The GitHub CLI isn't signed in. Run `gh auth login`, then try again."
    }
    return error
  }
}
