import ArgusCore
import ArgusUI
import SwiftUI

/// This Mac asked to join an account that already has devices: one of them
/// approves it after both show the same 6-digit code.
struct AccountJoinSection: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.theme) private var theme

  var body: some View {
    SettingsGroup(
      "Approve this Mac",
      footer: "Your account already has devices. Approve this Mac from one of them — Settings → Account on your iPhone, or on another computer. Requests last 10 minutes."
    ) {
      switch account.join {
      case .idle, .requesting:
        progress("Asking your account…")
      case .waiting:
        progress("Waiting for one of your devices to pick this up…")
      case .compare(let sas, let approverName):
        VStack(alignment: .leading, spacing: 8) {
          Text("\(approverName) shows a code too. Only confirm if they're the same:")
            .foregroundStyle(.secondary)
          AccountCodeText(sas: sas)
          HStack {
            Button("Codes Match") { Task { await account.confirmJoinCode() } }
              .buttonStyle(.accent)
              .keyboardShortcut(.defaultAction)
            Button("They Don't Match", role: .destructive) { Task { await account.rejectJoinCode() } }
              .buttonStyle(.secondary)
          }
        }
      case .confirmed(let approverName):
        progress("Confirmed here. Finish on \(approverName)…")
      case .alreadyApproved(let sas, let approverName):
        VStack(alignment: .leading, spacing: 8) {
          Text(
            "\(approverName) approved this Mac. Check that Settings → Account → Devices on \(approverName) shows this code next to this Mac:"
          )
          .foregroundStyle(.secondary)
          AccountCodeText(sas: sas)
          HStack {
            Button("Codes Match") { Task { await account.confirmApprovedJoin() } }
              .buttonStyle(.accent)
              .keyboardShortcut(.defaultAction)
            Button("Not Mine", role: .destructive) { Task { await account.rejectApprovedJoin() } }
              .buttonStyle(.secondary)
          }
        }
      case .denied:
        ended("The request was turned down.")
      case .expired:
        ended("The request expired before it was approved.")
      case .failed(let message):
        ended(message)
      }
      HStack {
        Spacer()
        Button("Sign Out") { Task { await account.signOut() } }
          .buttonStyle(.secondary)
      }
      SettingsError(text: account.error)
    }
  }

  private func progress(_ text: String) -> some View {
    HStack {
      ProgressView().controlSize(.small)
      Text(text).foregroundStyle(.secondary)
    }
  }

  private func ended(_ text: String) -> some View {
    HStack {
      SettingsError(text: text)
      Spacer()
      Button("Ask Again") { Task { await account.retryJoin() } }
        .buttonStyle(.accent)
    }
  }
}

/// `482 093`, large, the way every surface shows the code.
struct AccountCodeText: View {
  let sas: String

  var body: some View {
    Text("\(sas.prefix(3)) \(sas.suffix(3))")
      .font(.scaled(size: 28, weight: .semibold, design: .monospaced))
      .accessibilityLabel("Check code \(sas)")
  }
}
