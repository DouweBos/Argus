#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Settings, its pages and its Account page in each state, the Mac's ids.
  enum SettingsStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("settings/window", fixtures: GalleryFixtures.deviceHosts, setup: connect) {
          SettingsView()
        },
        GalleryStory("settings/appearance") { AppearanceSettingsPage() },
        GalleryStory("settings/name") { NameSettingsPage() },
        GalleryStory("settings/alerts") { AlertsSettingsPage() },
        GalleryStory("settings/privacy") { PrivacySettingsPage() },
        GalleryStory("settings/connection", fixtures: GalleryFixtures.deviceHosts, setup: connect) { ConnectionSettingsPage() },
        GalleryStory("settings/agents") { AgentsSettingsPage() },
        GalleryStory("settings/device-hosts", fixtures: GalleryFixtures.deviceHosts, setup: connect) {
          DeviceHostsSettingsPage()
        },
        GalleryStory("settings/accounts", fixtures: GalleryFixtures.runnerAccounts) { ClaudeAccountsView() },
        GalleryStory("settings/computer", fixtures: computerFixtures, setup: connect) { ComputerStory() },
        account("signed-in", GalleryAccount(selfKind: "ios")),
        account("signed-out", GalleryAccount(phase: .signedOut, selfKind: "ios")),
        account("awaiting-approval", GalleryAccount(phase: .awaitingApproval, selfKind: "ios")),
      ]
    }

    /// Signed in, with the account's studio Mac as the connected computer.
    @MainActor private static func connect(_ stage: GalleryStage) async {
      stage.app.account.galleryFill(GalleryAccount(selfKind: "ios"))
      stage.app.accountHosts = stage.app.account.hostIdentities
      let studio = stage.app.accountHosts.first { $0.label.contains("Studio") } ?? stage.app.accountHosts.first
      stage.app.identity = studio
      stage.app.activeHostId = studio?.deviceId
      await stage.host.refreshDeviceHosts()
    }

    private static var computerFixtures: [String: String] {
      GalleryFixtures.deviceHosts.merging([
        RemoteMethod.integrationsList.rawValue: GalleryJSON.encode([
          "integrations": [
            ["id": "github", "connected": true, "needsReauth": false, "oauthAvailable": true, "account": ["name": "alex-rivera"]],
            ["id": "linear", "connected": false, "needsReauth": false, "oauthAvailable": true],
          ]
        ])
      ]) { $1 }
    }

    private static func account(_ state: String, _ fixture: GalleryAccount) -> GalleryStory {
      GalleryStory("settings/account/\(state)", setup: { stage in stage.app.account.galleryFill(fixture) }) {
        AccountView()
      }
    }
  }

  /// The connected computer's own page.
  private struct ComputerStory: View {
    @Environment(AppStore.self) private var app

    var body: some View {
      ComputerView(deviceId: app.activeHostId ?? "")
    }
  }
#endif
