import ArgusUI
import SwiftUI

/// The computers this phone is paired with. Picking one connects to it — only
/// one at a time — and opens its projects.
struct HomeView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router


  var body: some View {
    List {
      if !app.loaded {
        Loading(label: "Unlocking…").listRowBackground(Color.clear)
      } else if !app.hosts.isEmpty {
        Section {
          ForEach(app.hosts) { computer in
            hostRow(computer)
          }
        } footer: {
          Text("Tap a computer to connect to it; the app talks to one at a time.")
        }
        Section {
          if app.account.isSignedIn {
            NavigationLink(value: Route.addComputer) {
              Label("Add a computer to your account", systemImage: Icon.plus)
            }
          }
          NavigationLink(value: Route.pair) {
            Label("Pair with a QR code", systemImage: Icon.qrCode)
          }
        }
      }
    }
    .emptyState(when: app.loaded && app.hosts.isEmpty) {
      EmptyState(
        icon: Icon.desktop,
        title: "No computers yet",
        body: """
          Sign in to your Argus account and your computers show up here. Or pair \
          with one by QR code from Settings → Remote in Argus on the computer.
          """
      ) {
        if !app.account.isSignedIn {
          Btn(label: "Sign in", hugs: true) { router.push(.account) }
        }
        Btn(label: "Scan a QR code", tone: app.account.isSignedIn ? .primary : .secondary, hugs: true) {
          router.push(.pair)
        }
      }
    }
    .navigationTitle("Computers")
    .navigationBarTitleDisplayMode(.inline)
    // Presence moves while the list is open: a host going quiet or coming back.
    .liveRefresh(enabled: app.account.isSignedIn, every: AccountStore.presencePollInterval) {
      await app.account.refreshDirectory()
    }
  }

  /// Tapping the row connects; the info button opens its details, as Wi-Fi does.
  private func hostRow(_ computer: DeviceIdentity) -> some View {
    let active = computer.deviceId == app.activeHostId
    return HStack(spacing: 10) {
      Button { open(computer) } label: {
        HStack(spacing: 10) {
          Image(systemName: active ? "checkmark" : Icon.desktop)
            .foregroundStyle(active ? theme.accent : theme.textSecondary)
            .frame(width: 22)
          VStack(alignment: .leading, spacing: 2) {
            Text(computer.label).foregroundStyle(theme.text).lineLimit(1)
            Text(subtitle(computer, active: active))
              .font(.footnote)
              .foregroundStyle(theme.textMuted)
              .lineLimit(1)
          }
          Spacer(minLength: 6)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.argusPlain)
      .accessibilityHint(active ? "Connected" : "Connects to this computer")

      Button {
        router.push(.computer(deviceId: computer.deviceId))
      } label: {
        Image(systemName: "info.circle")
          .font(.title3)
          .foregroundStyle(theme.accent)
          .frame(width: 44, height: 44)
          .contentShape(Rectangle())
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel("\(computer.label) details")
    }
  }

  private func subtitle(_ computer: DeviceIdentity, active: Bool) -> String {
    if active { return host.connection.label }
    if let presence = app.presence(of: computer) {
      return AccountPresenceText.text(online: presence.online, lastSeen: presence.lastSeen)
    }
    return DeviceIdentity.gatewayHost(computer.url)
  }

  /// Navigate first, connect second.
  ///
  /// Racing every endpoint takes seconds, and awaiting it here made a tap on
  /// a connecting machine look dead — while launch, which pushes straight
  /// through, showed a perfectly good loading state. The projects screen
  /// already handles "not connected yet", so let it.
  private func open(_ computer: DeviceIdentity) {
    Task { await app.selectHost(computer.deviceId) }
    // Projects is the tab's root, so returning to it is a pop, not a push.
    router.popToRoot()
  }
}
