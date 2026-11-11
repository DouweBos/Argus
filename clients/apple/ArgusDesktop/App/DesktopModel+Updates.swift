import AppKit
import ArgusCore
import ArgusKit
import ArgusUpdate

/// Sparkle follows the host's `updater_channel`.
extension DesktopModel {
  /// Points Sparkle at the host's `updater_channel`; a failed read keeps the
  /// last channel and is retried on reconnect, settings change and manual check.
  func syncUpdateChannel() async {
    await UpdateChannelSync(
      load: { [localBackend] in
        guard let localBackend else { throw UpdateChannelSync.NotConnected() }
        return try await localBackend.request(ArgusProtocol.Commands.GetAppSettings.self, EmptyParams())
          .updaterChannel?.rawValue
      },
      apply: { [updater] in updater.feed.channel = $0 },
      log: { NSLog("[argus] couldn't read the update channel: %@", HostStore.describe($0)) }
    ).sync()
  }

  /// Re-reads the channel first, so a manual check never uses a stale feed.
  func checkForUpdates() {
    Task {
      await syncUpdateChannel()
      updater.check()
    }
  }
}
