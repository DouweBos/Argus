import ArgusKit
import ClerkKit
import Foundation

/// Clerk behind `AccountAuthenticating`: native Sign in with Apple, GitHub in
/// a web authentication session, and an emailed code. The publishable key
/// comes from the account service at runtime, so nothing is baked in.
@MainActor
public final class AccountAuth: AccountAuthenticating {
  private var configuredKey: String?
  private var pendingSignIn: SignIn?
  private var pendingSignUp: SignUp?

  public init() {}

  public func configure(publishableKey: String) async throws {
    guard configuredKey != publishableKey else { return }
    if configuredKey == nil {
      Clerk.configure(publishableKey: publishableKey)
    } else {
      _ = try await Clerk.reconfigure(publishableKey: publishableKey)
    }
    configuredKey = publishableKey
    try await waitUntilLoaded()
  }

  public var isSignedIn: Bool {
    configuredKey != nil && Clerk.shared.session != nil
  }

  public var profile: AccountProfile? {
    guard configuredKey != nil, let user = Clerk.shared.user else { return nil }
    return AccountProfile(
      firstName: user.firstName, lastName: user.lastName, username: user.username,
      email: user.primaryEmailAddress?.emailAddress,
      // Without an upload Clerk serves a generated picture; initials read better.
      imageURL: user.hasImage ? URL(string: user.imageUrl) : nil)
  }

  public func signInWithApple(idToken: String?) async throws {
    if let idToken {
      // Signs up on first use, like the full flow.
      try await Clerk.shared.auth.signInWithIdToken(idToken, provider: .apple)
    } else {
      // Developer ID apps can't carry the entitlement, so Apple goes through the web.
      try await Clerk.shared.auth.signInWithOAuth(provider: .apple)
    }
    try await requireSession()
  }

  public func signInWithGitHub() async throws {
    try await Clerk.shared.auth.signInWithOAuth(provider: .github)
    try await requireSession()
  }

  /// Sign in when the address has an account, sign up when it doesn't; either
  /// way Clerk mails a code.
  public func sendEmailCode(_ email: String) async throws {
    pendingSignIn = nil
    pendingSignUp = nil
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      pendingSignIn = try await Clerk.shared.auth.signInWithEmailCode(emailAddress: address)
    } catch {
      let signUp = try await Clerk.shared.auth.signUp(emailAddress: address)
      pendingSignUp = try await signUp.sendEmailCode()
    }
  }

  public func verifyEmailCode(_ code: String) async throws {
    let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
    if let signIn = pendingSignIn {
      _ = try await signIn.verifyCode(trimmed)
    } else if let signUp = pendingSignUp {
      _ = try await signUp.verifyEmailCode(trimmed)
    } else {
      throw AccountAuthError.noPendingCode
    }
    pendingSignIn = nil
    pendingSignUp = nil
    try await requireSession()
  }

  public func token() async throws -> String? {
    guard configuredKey != nil else { return nil }
    return try await Clerk.shared.auth.getToken()
  }

  public func signOut() async throws {
    guard configuredKey != nil, Clerk.shared.session != nil else { return }
    try await Clerk.shared.auth.signOut()
  }

  private func waitUntilLoaded() async throws {
    for _ in 0..<100 where !Clerk.shared.isLoaded {
      try await Task.sleep(for: .milliseconds(100))
    }
  }

  /// A finished flow leaves an active session; anything else (an extra
  /// verification step this app doesn't offer) is an error, not a hang.
  private func requireSession() async throws {
    for _ in 0..<20 where Clerk.shared.session == nil {
      try await Task.sleep(for: .milliseconds(100))
    }
    if Clerk.shared.session == nil { throw AccountAuthError.incomplete }
  }
}

public enum AccountAuthError: LocalizedError {
  case noPendingCode
  case incomplete

  public var errorDescription: String? {
    switch self {
    case .noPendingCode: "Ask for a new code first."
    case .incomplete: "Sign-in needs a step this app doesn't support yet."
    }
  }
}
