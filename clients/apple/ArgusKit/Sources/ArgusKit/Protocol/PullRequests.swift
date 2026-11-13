import Foundation

/// Pull requests, as the computer's `gh` reports them. Ported from
/// `packages/remote-protocol/src/models.ts`.
///
/// Narrowed for a phone: the body, whether CI is happy, and the conversation.
/// The file-by-file review stays on the desktop.

public struct RemotePullRequest: Codable, Hashable, Sendable, Identifiable {
  public var number: Int
  public var title: String
  /// `owner/repo`, which is also how the write methods address it.
  public var repo: String
  /// The project this PR's repo maps to.
  public var repoRoot: String
  public var author: String?
  public var isDraft: Bool
  /// `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | nil.
  public var reviewDecision: String?
  public var headRef: String
  public var baseRef: String
  public var url: String
  public var updatedAt: String
  /// Why it's in your list: assigned, review requested, authored by you…
  public var reasons: [String]

  public var id: String { "\(repo)#\(number)" }

  enum CodingKeys: String, CodingKey {
    case number, title, repo, author, url, reasons
    case repoRoot = "repo_root"
    case isDraft = "is_draft"
    case reviewDecision = "review_decision"
    case headRef = "head_ref"
    case baseRef = "base_ref"
    case updatedAt = "updated_at"
  }
}

public struct RemotePullRequestCheck: Codable, Hashable, Sendable, Identifiable {
  public var name: String
  public var status: String?
  public var conclusion: String?

  public var id: String { name }

  /// Green, red, or still going.
  public var tone: Tone {
    switch conclusion?.lowercased() {
    case "success", "neutral", "skipped": .success
    case "failure", "timed_out", "startup_failure", "action_required": .danger
    case "cancelled", "stale": .muted
    default: status?.lowercased() == "completed" ? .muted : .warning
    }
  }

  public enum Tone: Sendable { case success, danger, warning, muted }
}

public struct RemotePullRequestComment: Codable, Hashable, Sendable, Identifiable {
  public var id: String
  public var author: String?
  public var body: String
  public var createdAt: String
  public var kind: Kind
  /// Review verdict for a `review` entry.
  public var reviewState: String?

  public enum Kind: String, Codable, Sendable { case issue, review }

  enum CodingKeys: String, CodingKey {
    case id, author, body, kind
    case createdAt = "created_at"
    case reviewState = "review_state"
  }
}

public struct RemotePullRequestDetail: Codable, Hashable, Sendable, Identifiable {
  public var number: Int
  public var title: String
  public var repo: String
  public var url: String
  public var author: String?
  public var body: String
  public var state: String
  public var isDraft: Bool
  public var merged: Bool
  /// GitHub's own word: `MERGEABLE`, `CONFLICTING`, `UNKNOWN`.
  public var mergeable: String
  public var headRef: String
  public var baseRef: String
  /// The head commit a review guide is keyed by; nil from a host that predates guides.
  public var headSha: String?
  public var additions: Int
  public var deletions: Int
  public var changedFiles: Int
  public var checks: [RemotePullRequestCheck]
  public var comments: [RemotePullRequestComment]

  public var id: String { "\(repo)#\(number)" }

  /// Nothing red, and nothing still running.
  public var checksPassing: Bool {
    !checks.isEmpty && checks.allSatisfy { $0.tone == .success || $0.tone == .muted }
  }

  enum CodingKeys: String, CodingKey {
    case number, title, repo, url, author, body, state, merged, mergeable, checks, comments
    case isDraft = "is_draft"
    case headRef = "head_ref"
    case baseRef = "base_ref"
    case headSha = "head_sha"
    case additions, deletions
    case changedFiles = "changed_files"
  }
}

public enum RemoteMergeStrategy: String, Codable, Sendable, CaseIterable {
  case squash, merge, rebase

  /// The last one used, remembered by every app that merges.
  public static let preferenceKey = "pullRequestMergeStrategy"

  public var label: String {
    switch self {
    case .squash: "Squash and merge"
    case .merge: "Create a merge commit"
    case .rebase: "Rebase and merge"
    }
  }
}
