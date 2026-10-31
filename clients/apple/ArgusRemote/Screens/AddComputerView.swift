import ArgusUI
import SwiftUI

/// Add a computer to the account by the code it shows (`argus-host login`,
/// or Sign in in Argus): type it, compare the 6-digit code, confirm.
struct AddComputerView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router

  @State private var code = ""

  private var account: AccountStore { app.account }

  var body: some View {
    Screen {
      switch account.link {
      case .idle, .failed:
        enterCode
      case .working(let message):
        Loading(label: message)
      case .confirm(let sas, let hostName):
        confirm(sas: sas, hostName: hostName)
      case .done(let hostName):
        EmptyState(
          icon: "checkmark.circle", title: "\(hostName) is on your account",
          body: "It shows up under Computers and connects without a QR code.")
        Btn(label: "Done") {
          account.resetLink()
          router.pop()
        }
      }
    }
    .navigationTitle("Add a Computer")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      // A link already under way (handed over by a paired computer) stays.
      switch account.link {
      case .done, .failed: account.resetLink()
      default: break
      }
    }
    .onDisappear {
      if case .confirm = account.link { Task { await account.denyLink() } }
    }
  }

  @ViewBuilder private var enterCode: some View {
    MutedText(
      "On the computer, run `argus-host login` or choose Sign in in Argus. Type the code it shows.")
    ThemedTextField(placeholder: "WDJB-MJHT", text: $code, mono: true, input: .code) { submit() }
    Btn(label: "Continue") { submit() }
      .disabled(AccountCodec.normalizeUserCode(code).count != 9)
    if case .failed(let message) = account.link {
      Banner(text: message, tone: .danger)
    }
  }

  @ViewBuilder private func confirm(sas: String, hostName: String) -> some View {
    TitleText("Compare the codes")
    MutedText("\(hostName) shows a code too. Only confirm if they're the same.")
    Card {
      Text(AccountMemberText.groupedCode(sas))
        .font(.system(size: 30, weight: .semibold, design: .monospaced))
        .kerning(4)
        .frame(maxWidth: .infinity)
        .foregroundStyle(theme.text)
        .accessibilityLabel("Check code \(sas)")
    }
    Btn(label: "Codes match") { Task { await account.confirmLink() } }
    Btn(label: "They don't match", tone: .danger) { Task { await account.denyLink() } }
  }

  private func submit() {
    guard AccountCodec.normalizeUserCode(code).count == 9 else { return }
    Task { await account.link(code: code) }
  }
}
