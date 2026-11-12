import ArgusCore
import ArgusUI
import SwiftUI

/// Another device removed this Mac from the account: said in the main window,
/// not only in Settings, with Join Again opening the account's sign-in.
struct AccountRemovedNotice: View {
  @Environment(DesktopModel.self) private var model
  @Environment(AccountStore.self) private var account
  @Environment(\.openSettings) private var openSettings

  var body: some View {
    if account.removedNotice {
      AccountRemovedBanner(deviceNoun: "Mac") {
        MacTelemetry.capture(.accountRemovedNotice(action: .signIn))
        model.settingsTab = .account
        openSettings()
      } onDismiss: {
        MacTelemetry.capture(.accountRemovedNotice(action: .dismiss))
        account.dismissRemovedNotice()
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
    }
  }
}
