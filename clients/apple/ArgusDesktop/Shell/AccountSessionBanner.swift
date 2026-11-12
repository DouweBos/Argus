import ArgusCore
import ArgusUI
import SwiftUI

/// The Argus account's sign-in went away: said in the main window, not only in
/// Settings, with Sign In Again opening the account's sign-in.
struct AccountSessionBanner: View {
  @Environment(DesktopModel.self) private var model
  @Environment(AccountStore.self) private var account
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    if let reason = account.sessionLostNotice {
      AccountSessionLostBanner(reason: reason, keeps: "your hosts and phone") {
        MacTelemetry.capture(.accountSessionNotice(action: .signIn, reason: reason))
        model.settingsTab = .account
        openSettings()
      } onDismiss: {
        MacTelemetry.capture(.accountSessionNotice(action: .dismiss, reason: reason))
        account.dismissSessionNotice()
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
    }
  }
}
