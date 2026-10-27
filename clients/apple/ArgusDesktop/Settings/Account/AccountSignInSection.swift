import ArgusCore
import ArgusUI
import AuthenticationServices
import SwiftUI

/// Signed out: Sign in with Apple, GitHub, or an emailed code.
struct AccountSignInSection: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.colorScheme) private var colorScheme
  @State private var email = ""
  @State private var code = ""

  var body: some View {
    SettingsGroup(
      "Sign in to Argus",
      footer: "Your hosts show up in Settings → Hosts with their current addresses, and this Mac's host joins your account, so your phone reaches it without a pairing code."
    ) {
      if Self.canSignInWithApple {
        appleButton
      }
      Button("Sign in with GitHub") { Task { await account.signIn(with: .github) } }

      if account.awaitingEmailCode {
        HStack {
          TextField("Code from the email", text: $code)
            .textFieldStyle(.roundedBorder)
            .onSubmit(verify)
          Button("Verify", action: verify).disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
          Button("Use Another Email") {
            code = ""
            account.cancelEmailCode()
          }
        }
      } else {
        HStack {
          TextField("you@example.com", text: $email)
            .textFieldStyle(.roundedBorder)
            .onSubmit(send)
          Button("Email Me a Code", action: send).disabled(!email.contains("@"))
        }
      }
      SettingsError(text: account.error)
    }
    .task { await account.prepare() }
  }

  private var appleButton: some View {
    SignInWithAppleButton(.signIn) { request in
      request.requestedScopes = [.email]
    } onCompletion: { result in
      guard case .success(let authorization) = result,
        let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
        let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) })
      else { return }
      Task { await account.signInWithApple(idToken: token) }
    }
    .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
    .frame(width: 240, height: 32)
    .clickable()
  }

  /// Sign in with Apple needs its entitlement, which needs a provisioning
  /// profile; a build signed without one offers GitHub and email only.
  static let canSignInWithApple: Bool = {
    guard let task = SecTaskCreateFromSelf(nil) else { return false }
    return SecTaskCopyValueForEntitlement(task, "com.apple.developer.applesignin" as CFString, nil) != nil
  }()

  private func send() {
    guard email.contains("@") else { return }
    Task { await account.sendEmailCode(email) }
  }

  private func verify() {
    Task { await account.verifyEmailCode(code) }
  }
}
