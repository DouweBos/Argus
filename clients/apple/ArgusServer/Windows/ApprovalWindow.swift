import ArgusCore
import ArgusUI
import SwiftUI

/// Approve a Join: the device or computer waiting to join the account, and
/// the 6-digit code to compare with its screen.
struct ApprovalWindow: View {
  let model: ServerModel
  @Environment(\.theme) private var theme
  @Environment(\.dismissWindow) private var dismissWindow

  var body: some View {
    VStack(spacing: 14) {
      Text("Approve a Join").font(.scaled(.title2).weight(.semibold))
      content
      if let notice = model.notice {
        Text(notice).foregroundStyle(theme.error).multilineTextAlignment(.center).textSelection(.enabled)
      }
    }
    .padding(24)
    .frame(width: 420)
  }

  private func noun(_ role: ArgusProtocol.AccountMemberRole) -> String {
    role == .host ? "computer" : "device"
  }

  @ViewBuilder
  private var content: some View {
    switch model.approval {
    case .awaitingSas(let approval):
      Text("\(approval.subjectName) (\(noun(approval.subjectRole))) wants to join your account. Only approve if it shows the same code:")
        .multilineTextAlignment(.center).foregroundStyle(theme.textSecondary)
      Text(AccountMenuModel.spaced(approval.sas))
        .font(.scaled(size: 34, weight: .semibold, design: .monospaced))
        .accessibilityLabel("Safety code \(approval.sas)")
      HStack {
        Button("Codes Differ — Deny", role: .destructive) { model.runAccount(.approvalConfirm(match: false)) }
        Button("Codes Match — Approve") { model.runAccount(.approvalConfirm(match: true)) }
          .keyboardShortcut(.defaultAction)
      }
    case .approved(let approved):
      Label("Approved. That \(noun(approved.subjectRole)) is now on your account.", systemImage: "checkmark.circle.fill")
        .foregroundStyle(theme.success)
      closeButton
    case .error(let error):
      Text("Approval failed: \(error.message)").foregroundStyle(theme.error)
      closeButton
    case .idle, .unknown:
      Text("Nothing to approve right now.").foregroundStyle(theme.textSecondary)
      closeButton
    }
  }

  private var closeButton: some View {
    Button("Done") {
      model.runAccount(.approvalDismiss)
      dismissWindow(id: ServerModel.Window.approval.rawValue)
    }
    .keyboardShortcut(.defaultAction)
  }
}
