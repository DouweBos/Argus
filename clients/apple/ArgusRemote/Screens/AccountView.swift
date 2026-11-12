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
  @State private var resetting = false
  @State private var removing: AccountStore.Host?
  @State private var renaming: AccountStore.Host?
  @State private var draft = ""

  private var account: AccountStore { app.account }

  @ViewBuilder private var content: some View {
    if account.phase == .ready {
      SettingsPage { signedIn }
    } else {
      Screen {
        switch account.phase {
        case .loading, .settingUp:
          Loading(label: account.phase == .loading ? "Checking your account…" : "Setting up your account…")
        // Signing in keeps the form, so a web sign-in that comes back shows where it left.
        case .signedOut, .signingIn:
          signIn.disabled(account.phase == .signingIn)
        case .awaitingApproval, .ready:
          awaitingApproval
        }
      }
    }
  }

  var body: some View {
    content
    .navigationTitle("Account")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $resetting) {
      AccountResetSheet(account: account, deviceNoun: "phone") { resetting = false }
        .presentationDetents([.medium, .large])
    }
    .task { await account.prepare() }
    // Presence moves while the list is open: a host going quiet or coming back.
    .liveRefresh(enabled: account.isSignedIn, every: AccountStore.presencePollInterval) {
      await app.account.refreshDirectory()
      await app.account.refreshRequests()
    }
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
    .alert(
      "Rename “\(renaming?.name ?? "")”",
      isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }),
      presenting: renaming
    ) { host in
      TextField("Name", text: $draft)
      Button("Cancel", role: .cancel) {}
      Button("Rename") { Task { await account.rename(memberId: host.id, to: draft) } }
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
    .frame(height: 44)
    .frame(maxWidth: Layout.maxControlWidth)
    // Apple's button draws no spinner of its own.
    if account.signingInWith == .apple {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        MutedText("Signing in with Apple…")
      }
    }

    Btn(
      label: "Sign in with GitHub", tone: .secondary, image: BrandIcon.github,
      busy: account.signingInWith == .github
    ) {
      Task { await account.signIn(with: .github) }
    }

    Card {
      if account.awaitingEmailCode {
        MutedText("Enter the code we emailed to \(email).")
        ThemedTextField(placeholder: "123456", text: $code, input: .code) { verifyCode() }
        HStack(spacing: 8) {
          Btn(label: "Verify", hugs: true, busy: account.signingInWith == .email) { verifyCode() }
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
          Btn(label: "Use another email", tone: .ghost) {
            code = ""
            account.cancelEmailCode()
          }
        }
      } else {
        MutedText("Or get a sign-in code by email")
        ThemedTextField(placeholder: "you@example.com", text: $email, input: .code) { sendCode() }
        Btn(label: "Email me a code", tone: .secondary) { sendCode() }
          .disabled(!email.contains("@"))
      }
    }

    if let error = account.error {
      Banner(text: error, tone: .danger)
    }

    Btn(label: "Pair with a QR code instead", tone: .secondary, icon: Icon.qrCode) { router.push(.pair) }
  }

  private func sendCode() {
    guard email.contains("@") else { return }
    Task { await account.sendEmailCode(email) }
  }

  private func verifyCode() {
    Task { await account.verifyEmailCode(code) }
  }

  // MARK: Not on the account yet

  private var profileHeader: some View {
    Card {
      AccountProfileSummary(account: account, avatarSize: 56)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  @ViewBuilder private var awaitingApproval: some View {
    if let notice = account.resetNotice {
      AccountResetNoticeBanner(notice: notice, deviceNoun: "phone") { account.dismissResetNotice() }
    }
    profileHeader
    JoinAccountView { resetting = true }
  }

  // MARK: Signed in

  @ViewBuilder private var signedIn: some View {
    SettingsGroup {
      AccountProfileSummary(account: account, avatarSize: 48)
    }

    AccountRequestsGroup()

    SettingsGroup(
      "Safety code",
      footer: "The same on every device on your account. If one ever shows a different code, it's looking at a different account."
    ) {
      Text(account.safetyCode ?? "—")
        .font(.scaled(size: 20, weight: .semibold, design: .monospaced))
        .foregroundStyle(theme.text)
        .textSelection(.enabled)
      if let logError = account.logError {
        Label(
          "The account service sent changes that don't check out (\(logError.rawValue)). Nothing was applied.",
          systemImage: Icon.warning
        )
        .font(.scaled(size: 13))
        .foregroundStyle(theme.error)
      }
    }

    SettingsGroup(
      "Computers",
      footer: "A computer that hasn't checked in for 15 minutes shows as offline; it's still tried at its last addresses."
    ) {
      if account.hosts.isEmpty {
        Text("No computers yet. Run `argus-host login`, or Sign in in Argus on the computer, and add the code it shows.")
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textSecondary)
      }
      ForEach(account.hosts) { host in
        hostRow(host)
      }
      Button { router.push(.addComputer) } label: {
        SettingsLinkRow("Add a Computer", systemImage: Icon.plus)
      }
      .buttonStyle(.settingsRow)
      .settingsRowFlush()
    }

    AccountDevicesGroup()

    SettingsGroup(footer: "Takes this phone off the account and deletes its account key. Computers you paired with a QR code keep working.") {
      HStack {
        Spacer()
        Btn(label: "Sign Out…", tone: .danger, small: true, hugs: true) { confirmingSignOut = true }
      }
      if let error = account.error {
        Label(error, systemImage: Icon.warning)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.error)
      }
    }

    SettingsGroup(
      "Reset account",
      footer: "Only when every other device and computer on your account is lost. Everything leaves the account and has to join again."
    ) {
      HStack {
        Spacer()
        Btn(label: "Reset Account…", tone: .secondary, small: true, hugs: true) { resetting = true }
      }
    }
  }

  private func hostRow(_ host: AccountStore.Host) -> some View {
    HStack(spacing: 10) {
      StatusDot(tone: host.online ? .success : .muted, pulse: false)
        .frame(width: TextScale.shared(24))
      VStack(alignment: .leading, spacing: 2) {
        Text(host.name)
          .font(.scaled(size: 15))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text(AccountPresenceText.text(online: host.online, lastSeen: host.lastSeen))
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
      }
      Spacer(minLength: 6)
      Menu {
        Button("Rename…", systemImage: "pencil") {
          draft = host.name
          renaming = host
        }
        Button("Remove…", systemImage: "trash", role: .destructive) { removing = host }
      } label: {
        Image(systemName: "ellipsis.circle")
          .font(.scaled(size: 17))
          .foregroundStyle(theme.textSecondary)
          .frame(width: 32, height: 32)
          .contentShape(.rect)
          .accessibilityLabel("Manage \(host.name)")
      }
    }
  }
}

/// The account's sign-in went away: said above every tab, not only on this
/// screen, with Sign in again opening it.
struct AccountSessionNotice: View {
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router

  var body: some View {
    if let reason = app.account.sessionLostNotice {
      AccountSessionLostBanner(reason: reason, keeps: "your computers") {
        Telemetry.capture(.accountSessionNotice(action: .signIn, reason: reason))
        if router.path(for: router.section).last != .account { router.push(.account) }
      } onDismiss: {
        Telemetry.capture(.accountSessionNotice(action: .dismiss, reason: reason))
        app.account.dismissSessionNotice()
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
    }
  }
}
