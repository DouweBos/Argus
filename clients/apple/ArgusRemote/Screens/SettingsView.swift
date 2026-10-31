import ArgusUI
import SwiftUI
import UIKit

/// Settings as a list of pages, grouped like the Mac's: this phone, the
/// computer it's connected to, and the computers it knows.
struct SettingsView: View {
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host

  var body: some View {
    Form {
      Section {
        NavigationLink(value: Route.account) {
          AccountProfileSummary(account: app.account, avatarSize: 52)
        }
        .accessibilityHint("Opens your Argus account")
      }

      Section {
        NavigationLink(value: Route.notifications) {
          LabeledContent {
            if app.unseenWarnings > 0 {
              Badge(label: "\(app.unseenWarnings)", tone: .danger)
            }
          } label: {
            Label("Notifications", systemImage: Icon.notifications)
          }
        }
      }

      Section(UIDevice.current.userInterfaceIdiom == .pad ? "This iPad" : "This iPhone") {
        row(.name, value: app.deviceName)
        row(.appearance, value: app.themePreference.label)
        row(.alerts)
        row(.privacy, value: app.telemetryMode == .full ? "Sharing" : "Minimal")
      }

      if let identity = app.identity {
        Section(identity.label) {
          row(.connection, value: host.connection.label)
          row(.agents)
          row(.automations)
          NavigationLink(value: Route.claudeAccounts) {
            Label("Claude accounts", systemImage: Icon.person)
          }
          NavigationLink(value: Route.usage) {
            Label("Usage", systemImage: Icon.usage)
          }
          if !host.deviceHosts.isEmpty {
            row(.deviceHosts, value: "\(host.deviceHosts.count)")
          }
        }
      }

      Section {
        if app.hosts.isEmpty {
          NavigationLink(value: Route.pair) {
            Label("Pair a computer", systemImage: Icon.plus)
          }
        } else {
          NavigationLink(value: Route.computers) {
            LabeledContent {
              Text("\(app.hosts.count)")
            } label: {
              Label("Computers", systemImage: Icon.desktop)
            }
          }
        }
      } footer: {
        Text("Pair with as many computers as you like; the app talks to one at a time.")
      }
    }
    .navigationTitle("Settings")
    .task(id: host.connection == .ready) {
      guard host.connection == .ready else { return }
      await host.refreshDeviceHosts()
    }
  }

  private func row(_ page: SettingsPage, value: String? = nil) -> some View {
    NavigationLink(value: Route.settingsPage(page)) {
      LabeledContent {
        if let value { Text(value).lineLimit(1) }
      } label: {
        Label(page.title, systemImage: page.symbol)
      }
    }
  }
}
