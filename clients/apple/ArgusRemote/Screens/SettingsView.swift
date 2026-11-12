import ArgusUI
import SwiftUI
import UIKit

/// Settings as a list of pages, grouped like the Mac's: this phone, the
/// computer it's connected to, and the computers it knows.
struct SettingsView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host

  var body: some View {
    SettingsPage {
      SettingsGroup {
        link(.account) {
          HStack(spacing: 12) {
            AccountProfileSummary(account: app.account, avatarSize: 48)
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
              .font(.scaled(size: 12, weight: .semibold))
              .foregroundStyle(theme.textMuted)
          }
          .padding(SettingsLayout.rowPadding)
          .contentShape(.rect)
        }
        .accessibilityHint("Opens your Argus account")
      }

      SettingsGroup(UIDevice.current.userInterfaceIdiom == .pad ? "This iPad" : "This iPhone") {
        row(.name, value: app.deviceName)
        row(.appearance, value: app.themePreference.label)
        row(.alerts)
        row(.privacy, value: app.telemetryMode == .full ? "Sharing" : "Minimal")
      }

      if let identity = app.identity {
        SettingsGroup(identity.label) {
          row(.connection, value: host.connection.label)
          row(.agents)
          row(.automations)
          link(.claudeAccounts) { SettingsLinkRow("Accounts", systemImage: Icon.person) }
          link(.usage) { SettingsLinkRow("Usage", systemImage: Icon.usage) }
          if !host.deviceHosts.isEmpty {
            row(.deviceHosts, value: "\(host.deviceHosts.count)")
          }
        }
      }

      SettingsGroup(footer: "Pair with as many computers as you like; the app talks to one at a time.") {
        if app.hosts.isEmpty {
          link(.pair) { SettingsLinkRow("Pair a Computer", systemImage: Icon.plus) }
        } else {
          link(.computers) {
            SettingsLinkRow("Computers", systemImage: Icon.desktop, value: "\(app.hosts.count)")
          }
        }
      }
    }
    .navigationTitle("Settings")
    .task(id: host.connection == .ready) {
      guard host.connection == .ready else { return }
      await host.refreshDeviceHosts()
    }
  }

  private func row(_ page: SettingsPane, value: String? = nil) -> some View {
    link(.settingsPage(page)) { SettingsLinkRow(page.title, systemImage: page.symbol, value: value) }
  }

  private func link(_ route: Route, @ViewBuilder label: () -> some View) -> some View {
    NavigationLink(value: route, label: label)
      .buttonStyle(.settingsRow)
      .settingsRowFlush()
  }
}
