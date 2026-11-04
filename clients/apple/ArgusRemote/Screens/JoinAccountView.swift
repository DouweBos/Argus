import ArgusUI
import SwiftUI

/// Settings → Account on a phone the account doesn't know yet: it asked to
/// join, and a device already on the account approves it after both show the
/// same 6-digit code.
struct JoinAccountView: View {
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  /// Nobody left to approve: start the account over.
  let onReset: () -> Void

  private var account: AccountStore { app.account }

  var body: some View {
    switch account.join {
    case .idle, .requesting:
      Loading(label: "Asking your account…")
    case .waiting:
      EmptyState(
        icon: "hourglass",
        title: "Approve this phone",
        body: """
          Your account already has devices. Open Argus on one of them — your other iPhone, \
          the Mac app, or Settings → Account on a computer — and approve this phone there.
          """)
    case .compare(let sas, let approverName):
      TitleText("Compare the codes")
      MutedText("\(approverName) shows a code too. Only confirm if they're the same.")
      SasCode(sas: sas)
      Btn(label: "Codes match") { Task { await account.confirmJoinCode() } }
      Btn(label: "They don't match", tone: .danger) { Task { await account.rejectJoinCode() } }
    case .confirmed(let approverName):
      Loading(label: "Confirmed here. Finish on \(approverName)…")
    case .alreadyApproved(let sas, let approverName):
      TitleText("\(approverName) approved this phone")
      MutedText(
        "Check that Settings → Account → Devices on \(approverName) shows this code next to this phone.")
      SasCode(sas: sas)
      Btn(label: "Codes match") { Task { await account.confirmApprovedJoin() } }
      Btn(label: "Not mine", tone: .danger) { Task { await account.rejectApprovedJoin() } }
    case .denied:
      ended("Not approved", body: "The request was turned down. Ask again when you're at your other device.")
    case .expired:
      ended("The request expired", body: "Approve it within 10 minutes. Ask again to get a new one.")
    case .failed(let message):
      ended("This phone didn't join", body: message)
    }
    if let error = account.error {
      Banner(text: error, tone: .danger)
    }
    Btn(label: "Pair with a QR code instead", tone: .secondary, icon: Icon.qrCode) { router.push(.pair) }
    if account.canReset {
      Field(
        label: "Nobody left to approve?",
        caption: "Lost every device and computer on your account? Reset it from this phone and link your computers again."
      ) {
        Btn(label: "Reset account…", tone: .ghost, action: onReset)
      }
    }
    Btn(label: "Sign out", tone: .ghost) { Task { await account.signOut() } }
  }

  @ViewBuilder private func ended(_ title: String, body: String) -> some View {
    EmptyState(icon: "xmark.circle", title: title, body: body)
    Btn(label: "Ask again") { Task { await account.retryJoin() } }
  }
}

/// `482 093`, large, as every surface prints it.
struct SasCode: View {
  @Environment(\.theme) private var theme
  let sas: String

  var body: some View {
    Card {
      Text(AccountMemberText.groupedCode(sas))
        .font(.system(size: 30, weight: .semibold, design: .monospaced))
        .kerning(4)
        .frame(maxWidth: .infinity)
        .foregroundStyle(theme.text)
        .accessibilityLabel("Check code \(sas)")
    }
  }
}
