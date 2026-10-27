import Foundation

/// The sign-in provider behind an account: Clerk in the apps (`ArgusAuth`),
/// a fake in tests. Only its session token ever reaches the account service.
@MainActor
public protocol AccountAuthenticating: AnyObject, Sendable {
  /// Point the provider at the account's Clerk instance (from `GET /config`).
  func configure(publishableKey: String) async throws
  var isSignedIn: Bool { get }
  /// With the identity token from the system's Sign in with Apple button, or
  /// nil to run Apple's sheet from here.
  func signInWithApple(idToken: String?) async throws
  func signInWithGitHub() async throws
  func sendEmailCode(_ email: String) async throws
  func verifyEmailCode(_ code: String) async throws
  /// A short-lived session JWT for `Authorization: Bearer`.
  func token() async throws -> String?
  func signOut() async throws
}

public enum AccountSignInProvider: String, Sendable {
  case apple, github, email
}
