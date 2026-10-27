import ArgusUI
import AuthenticationServices
import SwiftUI

/// Settings → Account: sign in once and every computer on the account shows
/// up, with no QR per computer. Sign in with Apple comes first (App Store 4.8).
struct AccountView: View {
  @Environment(\.theme) private var theme
  @Environment(\.colorScheme) private var colorScheme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router

  @State private var email = ""
  @State private var code = ""
  @State private var confirmingSignOut = false
  @State private var removing: AccountStore.Host?

  private var account: AccountStore { app.account }

  var body: some View {
    Screen {
      switch account.phase {
      case .loading, .settingUp:
        Loading(label: account.phase == .loading ? "Checking your account…" : "Setting up your account…")
      case .signingIn:
        Loading(label: "Signing in…")
      case .signedOut:
        signIn
      case .awaitingApproval:
        awaitingApproval
      case .ready:
        signedIn
      }
    }
    .navigationTitle("Account")
    .navigationBarTitleDisplayMode(.inline)
    .task { await account.prepare() }
    .alert("Sign out of your account?", isPresented: $confirmingSignOut) {
      Button("Cancel", role: .cancel) {}
      Button("Sign out", role: .destructive) { Task { await account.signOut() } }
    } message: {
      Text("This phone is taken off the account and its account key is deleted. Computers you paired with a QR code keep working.")
    }
    .alert(
      "Remove “\(removing?.name ?? "")” from your account?",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
    ) {
      Button("Cancel", role: .cancel) {}
      Button("Remove", role: .destructive) {
        if let host = removing { Task { await account.remove(memberId: host.id) } }
      }
    } message: {
      Text("Your devices stop connecting to it through the account. Link it again with a new code.")
    }
  }

  // MARK: Signed out

  @ViewBuilder private var signIn: some View {
    TitleText("Sign in to Argus")
    MutedText(
      "Your computers show up here with their current addresses, so you can connect without scanning a code for each one.")

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
    .frame(height: 46)
    .frame(maxWidth: 420)

    Btn(label: "Sign in with GitHub", tone: .secondary, image: BrandIcon.github) {
      Task { await account.signIn(with: .github) }
    }

    Card {
      if account.awaitingEmailCode {
        MutedText("Enter the code we emailed to \(email).")
        ThemedTextField(placeholder: "123456", text: $code, input: .code) { verifyCode() }
        HStack(spacing: 8) {
          Btn(label: "Verify", small: true, hugs: true) { verifyCode() }
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
          Btn(label: "Use another email", tone: .ghost, small: true) {
            code = ""
            account.cancelEmailCode()
          }
        }
      } else {
        MutedText("Or get a sign-in code by email")
        ThemedTextField(placeholder: "you@example.com", text: $email, input: .code) { sendCode() }
        Btn(label: "Email me a code", tone: .secondary, small: true) { sendCode() }
          .disabled(!email.contains("@"))
      }
    }

    if let error = account.error {
      Banner(text: error, tone: .danger)
    }

    Btn(label: "Pair with a QR code instead", tone: .ghost) { router.push(.pair) }
  }

  private func sendCode() {
    guard email.contains("@") else { return }
    Task { await account.sendEmailCode(email) }
  }

  private func verifyCode() {
    Task { await account.verifyEmailCode(code) }
  }

  // MARK: Not on the account yet

  @ViewBuilder private var awaitingApproval: some View {
    EmptyState(
      icon: "hourglass",
      title: "Waiting for device approval",
      body: """
        Your account already has devices. Approving a new one from them is coming soon; \
        until then, pair this phone with each computer by QR code.
        """)
    Btn(label: "Pair with a QR code", tone: .secondary) { router.push(.pair) }
    Btn(label: "Sign out", tone: .ghost) { Task { await account.signOut() } }
  }

  // MARK: Signed in

  @ViewBuilder private var signedIn: some View {
    Field(
      label: "Safety code",
      caption: "The same on every device on your account. If one ever shows a different code, it's looking at a different account."
    ) {
      Text(account.safetyCode ?? "—")
        .font(.system(size: 20, weight: .semibold, design: .monospaced))
        .foregroundStyle(theme.text)
        .textSelection(.enabled)
    }

    if let logError = account.logError {
      Banner(
        text: "The account service sent changes that don't check out (\(logError.rawValue)). Nothing was applied.",
        tone: .danger)
    }

    Field(label: "Computers") {
      if account.hosts.isEmpty {
        MutedText("No computers yet. Run `argus-host login`, or Sign in in Argus on the computer, and add the code it shows.")
      }
      ForEach(account.hosts) { host in
        hostRow(host)
      }
      Btn(label: "Add a computer", icon: "plus") { router.push(.addComputer) }
    }

    if let error = account.error {
      Banner(text: error, tone: .danger)
    }

    Field(label: "Sign out", caption: "Takes this phone off the account. QR pairings keep working.") {
      Btn(label: "Sign out", tone: .danger) { confirmingSignOut = true }
    }
  }

  private func hostRow(_ host: AccountStore.Host) -> some View {
    Card {
      HStack(spacing: 8) {
        Image(systemName: Icon.desktop)
          .foregroundStyle(host.online ? theme.success : theme.textSecondary)
        VStack(alignment: .leading, spacing: 2) {
          BodyText(host.name, lineLimit: 1)
          MutedText(AccountPresenceLabel.text(online: host.online, lastSeen: host.lastSeen), lineLimit: 1)
        }
        Spacer(minLength: 6)
        IconBtn(systemName: "trash", label: "Remove \(host.name)") { removing = host }
      }
    }
  }
}

/// "Online", or "Offline · last seen 2 h ago".
enum AccountPresenceLabel {
  static func text(online: Bool, lastSeen: Double?, now: Date = Date()) -> String {
    if online { return "Online" }
    guard let lastSeen else { return "Offline" }
    let seen = Date(timeIntervalSince1970: lastSeen / 1000)
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return "Offline · last seen \(formatter.localizedString(for: seen, relativeTo: now))"
  }
}
