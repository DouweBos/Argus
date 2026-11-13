import ArgusCore
import ArgusKit
import Foundation

/// How a PR's reasons, review state and dates read, on the Mac and the phone alike.
public enum PullRequestLabels {
  /// Whether a pull request URL is a GitLab merge request.
  public static func isGitLab(_ url: String?) -> Bool {
    guard let url else { return false }
    return url.contains("/-/merge_requests/") || (URL(string: url)?.host?.contains("gitlab") ?? false)
  }

  /// "GitHub" or "GitLab", for "Open on …".
  public static func host(_ url: String?) -> String { isGitLab(url) ? "GitLab" : "GitHub" }

  public static func openOn(_ url: String?) -> String { "Open on \(host(url))" }

  /// `#123` on GitHub, `!123` on GitLab.
  public static func ref(number: Int, url: String?) -> String {
    isGitLab(url) ? "!\(number)" : "#\(number)"
  }

  /// "Pull request #123 · Merged", or "Merge request !123" on GitLab.
  public static func state(_ pr: RemoteSessionPullRequest) -> String {
    let state =
      switch pr.state {
      case .open: "Open"
      case .draft: "Draft"
      case .merged: "Merged"
      case .closed: "Closed"
      }
    let noun = isGitLab(pr.url) ? "Merge request" : "Pull request"
    return "\(noun) \(ref(number: pr.number, url: pr.url)) · \(state)"
  }

  /// The state, plus that an agent is watching it.
  public static func state(_ pr: RemoteSessionPullRequest, watching: Bool) -> String {
    watching ? "\(state(pr)) · Watched" : state(pr)
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

  /// `gh` or `glab` missing or signed out is the usual failure; say how to fix it.
  public static func explain(_ error: String) -> String {
    let lower = error.lowercased()
    if lower.contains("glab") || lower.contains("gitlab") {
      if lower.contains("not installed") || lower.contains("enoent") {
        return "The GitLab CLI (glab) is required. Install it and run `glab auth login`, then try again."
      }
      if lower.contains("signed in") || lower.contains("auth login") {
        return "The GitLab CLI isn't signed in. Run `glab auth login`, then try again."
      }
    }
    if lower.contains("enoent") || lower.contains("not found") && lower.contains("gh") {
      return "The GitHub CLI (gh) is required. Install it and run `gh auth login`, then try again."
    }
    if lower.contains("auth login") || lower.contains("not logged") || lower.contains("authenticat") {
      return "The GitHub CLI isn't signed in. Run `gh auth login`, then try again."
    }
    return error
  }
}
