import ArgusCore
import ArgusKit
import Foundation

/// How a PR's reasons, review state and dates read, on the Mac and the phone alike.
public enum PullRequestLabels {
  /// "Pull request #123 · Merged".
  public static func state(_ pr: RemoteSessionPullRequest) -> String {
    let state =
      switch pr.state {
      case .open: "Open"
      case .draft: "Draft"
      case .merged: "Merged"
      case .closed: "Closed"
      }
    return "Pull request #\(pr.number) · \(state)"
  }

  public static func reason(_ raw: String) -> String {
    switch raw {
    case "author": "Author"
    case "reviewer": "Reviewer"
    case "team": "Team review"
    case "commenter": "Commented"
    case "mentioned": "Mentioned"
    default: raw.capitalized
    }
  }

  public static func reasonTone(_ raw: String) -> Tone {
    switch raw {
    case "author": .accent
    case "reviewer", "team": .success
    default: .muted
    }
  }

  public static func review(_ decision: String) -> (label: String, tone: Tone)? {
    switch decision {
    case "APPROVED": ("Approved", .success)
    case "CHANGES_REQUESTED": ("Changes requested", .danger)
    case "REVIEW_REQUIRED": ("Review required", .warning)
    default: nil
    }
  }

  public static func relative(_ iso: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    guard let date else { return iso }
    return date.formatted(.relative(presentation: .named))
  }

  /// `gh` missing or signed out is the usual failure; say how to fix it.
  public static func explain(_ error: String) -> String {
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
