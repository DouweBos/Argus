import ArgusCore
import ArgusUI
import SwiftUI

/// The update channel. Kept on the host so the Mac app's updater reads the
/// same choice the desktop's did.
struct AdvancedSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host

  var body: some View {
    SettingsPage {
      SettingsGroup("Updates") {
        if host.loaded {
          SettingsRow(
            "Update channel",
            description: "Auto-updater feed. Leave on Production for stable releases. Switch to Beta to receive "
              + "in-development builds of upcoming features — Beta builds should work, but they may "
              + "contain bugs that haven't surfaced yet. Applies to updates once this app updates "
              + "itself; for now the choice is only saved."
          ) {
            Picker("Channel", selection: channel) {
              Text("Production").tag(ArgusProtocol.AppSettingsUpdaterChannel.latest)
              Text("Beta").tag(ArgusProtocol.AppSettingsUpdaterChannel.beta)
            }
            .pickerStyle(.segmented)
          }
        } else {
          SettingsLoading()
        }
      }
      SettingsError(text: host.error)
    }
  }

  /// Legacy `alpha` reads as Production: it's no longer subscribable in-app.
  private var channel: Binding<ArgusProtocol.AppSettingsUpdaterChannel> {
    Binding(
      get: { host.settings?.updaterChannel == .beta ? .beta : .latest },
      set: { next in
        Task {
          await host.save(.updateChannel, ["updater_channel": .string(next.rawValue)]) {
            $0.updaterChannel = next
          }
        }
      })
  }
}
