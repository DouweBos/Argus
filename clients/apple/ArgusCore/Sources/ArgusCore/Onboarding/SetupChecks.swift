import ArgusKit
import Foundation

public typealias PrereqResult = ArgusProtocol.PrereqResult
public typealias PrereqId = ArgusProtocol.PrereqId

/// The environment checks the desktop surfaces as home-screen cards (and the
/// Mac's first run walks through): only what's actually wrong shows.
public enum SetupChecks {
  /// The four checks agents can't run without.
  public static let core: [PrereqId] = [.claudeCli, .claudeAuth, .gitCli, .gitIdentity]

  public enum Card: Equatable, Sendable {
    /// Claude Code isn't installed; `fixable` means the host can install it.
    case claudeCliMissing(fixable: Bool, detail: String?)
    case claudeAuth(AuthCopy)
    case gitMissing(detail: String?)
    case gitIdentity
  }

  /// What the auth card says, per the reason the check found.
  public struct AuthCopy: Equatable, Sendable {
    public let headline: String
    public let body: String
    public let action: String
    /// Whether the action is a fresh sign-in rather than managing accounts.
    public let signsIn: Bool
  }

  /// Only a verdict: a check still running (or not run) is unknown, not failing.
  public static func needsAttention(_ result: PrereqResult?) -> Bool {
    result?.status == .fail || result?.status == .warn
  }

  /// The cards to show, in the desktop's order. Auth waits on the CLI: with
  /// no `claude` there's nothing to sign in with.
  public static func cards(_ results: [PrereqId: PrereqResult]) -> [Card] {
    var cards: [Card] = []
    if let cli = results[.claudeCli], needsAttention(cli) {
      cards.append(.claudeCliMissing(fixable: cli.fixable == true, detail: cli.detail))
    } else if let auth = results[.claudeAuth], needsAttention(auth) {
      cards.append(.claudeAuth(authCopy(auth.authReason)))
    }
    if let git = results[.gitCli], needsAttention(git) {
      cards.append(.gitMissing(detail: git.detail))
    }
    if needsAttention(results[.gitIdentity]) {
      cards.append(.gitIdentity)
    }
    return cards
  }

  public static func authCopy(_ reason: ArgusProtocol.ClaudeAuthReason?) -> AuthCopy {
    switch reason {
    case .unauthenticated:
      AuthCopy(
        headline: "No Claude account can authenticate.",
        body: "Sign in again to renew the credentials.", action: "Sign in", signsIn: true)
    case .selectedRateLimited:
      AuthCopy(
        headline: "Rate-limited account selected.",
        body: "Another account has quota — switch to it to keep spawning agents.",
        action: "Switch account", signsIn: false)
    case .selectedSignedOut:
      AuthCopy(
        headline: "Signed-out account selected.",
        body: "Another account is ready — switch to it to spawn agents.",
        action: "Switch account", signsIn: false)
    case .allRateLimited:
      AuthCopy(
        headline: "Every Claude account is out of usage.",
        body: "Limits clear on their own, or add another account.",
        action: "Manage accounts", signsIn: false)
    case .unverifiable:
      AuthCopy(
        headline: "Could not verify your Claude account.",
        body: "Re-check once you have network — the credentials may be fine.",
        action: "Manage accounts", signsIn: false)
    default:
      AuthCopy(
        headline: "No Claude account authenticated.",
        body: "Sign in so Argus can spawn agents.", action: "Sign in", signsIn: true)
    }
  }

  /// The desktop's rule: a name, and something shaped like an address.
  public static func isValidIdentity(name: String, email: String) -> Bool {
    let email = email.trimmingCharacters(in: .whitespaces)
    return !name.trimmingCharacters(in: .whitespaces).isEmpty
      && email.range(of: #".+@.+\..+"#, options: .regularExpression) != nil
  }

  /// Titles and how-to-install hints, as the desktop's checklist shows them.
  public struct Meta: Sendable {
    public let title: String
    public let installCommand: String?
    public let installLabel: String?
    public let installURL: String?
  }

  public static func meta(_ id: PrereqId) -> Meta {
    switch id {
    case .claudeCli:
      Meta(
        title: "Claude Code CLI", installCommand: "npm install -g @anthropic-ai/claude-code",
        installLabel: "Install guide",
        installURL: "https://docs.claude.com/en/docs/claude-code/quickstart")
    case .claudeAuth:
      Meta(
        title: "Claude authentication", installCommand: "claude login", installLabel: "Sign-in help",
        installURL: "https://docs.claude.com/en/docs/claude-code/quickstart")
    case .gitCli:
      Meta(
        title: "Git on PATH", installCommand: "xcode-select --install", installLabel: "git-scm.com",
        installURL: "https://git-scm.com/downloads/mac")
    case .gitIdentity:
      Meta(title: "Git identity", installCommand: nil, installLabel: nil, installURL: nil)
    default:
      Meta(title: id.rawValue, installCommand: nil, installLabel: nil, installURL: nil)
    }
  }
}
