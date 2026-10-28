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
  /// Who is signed in, for the account header. Shown on this device only.
  var profile: AccountProfile? { get }
}

extension AccountAuthenticating {
  public var profile: AccountProfile? { nil }
}

/// The signed-in person as the sign-in provider knows them. Never leaves the device.
public struct AccountProfile: Equatable, Sendable {
  public var firstName: String?
  public var lastName: String?
  public var username: String?
  public var email: String?
  public var imageURL: URL?

  public init(
    firstName: String? = nil, lastName: String? = nil, username: String? = nil, email: String? = nil,
    imageURL: URL? = nil
  ) {
    self.firstName = firstName
    self.lastName = lastName
    self.username = username
    self.email = email
    self.imageURL = imageURL
  }

  /// First and last name, else the username, else the email.
  public var displayName: String? {
    let full = [firstName, lastName].compactMap(Self.clean).joined(separator: " ")
    return Self.clean(full) ?? Self.clean(username) ?? Self.clean(email)
  }

  /// The email, unless it is already the display name.
  public var subtitle: String? {
    guard let email = Self.clean(email), email != displayName else { return nil }
    return email
  }

  /// One or two letters for an avatar without a picture.
  public var initials: String {
    let names = [firstName, lastName].compactMap(Self.clean)
    let letters = names.isEmpty ? [displayName ?? ""].compactMap(\.first) : names.compactMap(\.first)
    return String(letters.prefix(2)).uppercased()
  }

  private static func clean(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
    return trimmed
  }
}

public enum AccountSignInProvider: String, Sendable {
  case apple, github, email
}
