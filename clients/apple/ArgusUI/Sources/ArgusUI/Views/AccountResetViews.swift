import ArgusCore
import SwiftUI

/// Starting the account over (§5.8): the warning, the emailed code that
/// confirms it's you, and the reset. Shared by the iPhone and the Mac app.
public struct AccountResetSheet: View {
  let account: AccountStore
  /// "phone" or "Mac": what this device is called in the copy.
  let deviceNoun: String
  let onClose: () -> Void

  @State private var code = ""
  @State private var started = false

  public init(account: AccountStore, deviceNoun: String, onClose: @escaping () -> Void) {
    self.account = account
    self.deviceNoun = deviceNoun
    self.onClose = onClose
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      switch account.reset {
      case .idle, .failed:
        TitleText("Reset your account?")
        BodyText(
          """
          Only do this if you've lost every device and computer that could approve this \(deviceNoun). \
          Everything leaves your account: each computer has to be linked again from its own keyboard, \
          and your other devices ask to join again. Computers you paired with a QR code keep working.
          """)
        if case .failed(let message) = account.reset {
          Banner(text: message, tone: .danger)
        }
        Btn(label: "Reset account", tone: .danger) {
          started = true
          Task { await account.beginReset() }
        }
        Btn(label: "Cancel", tone: .ghost, action: close)
      case .sendingCode:
        Loading(label: "Sending a code…")
      case .resetting:
        Loading(label: "Resetting your account…")
      case .awaitingCode(let email):
        TitleText("Confirm it's you")
        MutedText("We sent a code to \(email). Enter it to reset your account.")
        ThemedTextField(
          placeholder: "Code", text: $code, keyboard: .decimalPad, mono: true, input: .code, onSubmit: confirm)
        if let error = account.error {
          Banner(text: error, tone: .danger)
        }
        Btn(label: "Confirm and reset", tone: .danger, action: confirm)
          .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
        Btn(label: "Cancel", tone: .ghost, action: close)
      }
    }
    .padding(20)
    .onChange(of: account.reset) { _, now in
      if started, now == .idle, account.phase == .ready { onClose() }
    }
  }

  private func confirm() {
    let typed = code
    code = ""
    Task { await account.confirmResetCode(typed) }
  }

  private func close() {
    account.cancelReset()
    onClose()
  }
}

/// The account was reset from another device: this one asks to join again.
public struct AccountResetNoticeBanner: View {
  let notice: AccountResetNotice
  let deviceNoun: String
  let onDismiss: () -> Void

  public init(notice: AccountResetNotice, deviceNoun: String, onDismiss: @escaping () -> Void) {
    self.notice = notice
    self.deviceNoun = deviceNoun
    self.onDismiss = onDismiss
  }

  public var body: some View {
    Banner(
      text: Self.text(notice, deviceNoun: deviceNoun), tone: .warning, title: "Your account was reset",
      actionLabel: "Dismiss", action: onDismiss)
  }

  static func text(_ notice: AccountResetNotice, deviceNoun: String) -> String {
    let by = notice.byName.map { " from “\($0)”" } ?? ""
    let on = notice.at.map { " on \($0.formatted(date: .abbreviated, time: .shortened))" } ?? ""
    let approver = notice.byName ?? "that device"
    return "It was reset\(by)\(on). This \(deviceNoun) left it — approve it from \(approver) to come back."
  }
}
