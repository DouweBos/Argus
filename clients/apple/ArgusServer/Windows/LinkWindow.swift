import ArgusCore
import ArgusUI
import SwiftUI

/// Link to Your Argus Account: the code to type on a phone, then the 6-digit
/// code to compare — the menu's account lines, larger.
struct LinkWindow: View {
  let model: ServerModel
  @Environment(\.theme) private var theme
  @Environment(\.dismissWindow) private var dismissWindow

  var body: some View {
    VStack(spacing: 14) {
      Text("Link to Your Argus Account").font(.scaled(.title2).weight(.semibold))
      content
      if let failure = model.link.failure ?? model.notice {
        Text(failure).foregroundStyle(theme.error).multilineTextAlignment(.center).textSelection(.enabled)
      }
    }
    .padding(24)
    .frame(width: 420)
  }

  @ViewBuilder
  private var content: some View {
    switch model.account?.link ?? model.link.state {
    case .awaitingClaim(let claim)?:
      Text("On your phone: Settings → Account → Add a computer, then type this code. Or open \(AccountMenuModel.withoutScheme(claim.verificationUri)).")
        .multilineTextAlignment(.center).foregroundStyle(theme.textSecondary)
      Text(claim.userCode)
        .font(.scaled(size: 30, weight: .semibold, design: .monospaced))
        .textSelection(.enabled)
      HStack {
        Button("Copy Code") { model.runAccount(.linkCopyCode(claim.userCode)) }
        Button("Open Link Page") { model.runAccount(.linkOpen(claim.verificationUriComplete)) }
        Button("Cancel", role: .cancel) { model.runAccount(.linkCancel) }
      }
    case .awaitingFirst?:
      Text("Your account has no computers yet. Make this one the first?")
        .multilineTextAlignment(.center).foregroundStyle(theme.textSecondary)
      HStack {
        Button("Cancel", role: .cancel) { model.runAccount(.linkCancel) }
        Button("Make This Computer the First") { model.runAccount(.linkConfirm(match: true)) }
          .keyboardShortcut(.defaultAction)
      }
    case .awaitingSas(let sas)?:
      Text("\(sas.approverName) is adding this computer. Only confirm if it shows the same code:")
        .multilineTextAlignment(.center).foregroundStyle(theme.textSecondary)
      Text(AccountMenuModel.spaced(sas.sas))
        .font(.scaled(size: 34, weight: .semibold, design: .monospaced))
        .accessibilityLabel("Safety code \(sas.sas)")
      HStack {
        Button("Codes Differ — Cancel", role: .destructive) { model.runAccount(.linkConfirm(match: false)) }
        Button("Codes Match — Link") { model.runAccount(.linkConfirm(match: true)) }
          .keyboardShortcut(.defaultAction)
      }
    case .awaitingApproval?:
      ProgressView("Confirmed here. Waiting for the other side…")
    case .linked?:
      Label("This computer is on your account.", systemImage: "checkmark.circle.fill")
        .foregroundStyle(theme.success)
      Button("Done") { dismissWindow(id: ServerModel.Window.link.rawValue) }.keyboardShortcut(.defaultAction)
    case .error(let error)?:
      Text("Linking failed: \(error.message)").foregroundStyle(theme.error)
      Button("Try Again") { model.runAccount(.linkStart) }
    case .idle?, .unknown?, nil:
      Button("Get a Code") { model.runAccount(.linkStart) }.keyboardShortcut(.defaultAction)
    }
  }
}
