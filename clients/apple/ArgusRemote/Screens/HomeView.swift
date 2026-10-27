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
    Screen {
      if !app.loaded {
        Loading(label: "Unlocking…")
      } else if app.hosts.isEmpty {
        EmptyState(
          icon: Icon.desktop,
          title: "No computers yet",
          body: """
            Sign in to your Argus account and your computers show up here. Or pair \
            with one by QR code from Settings → Remote Access on the computer.
            """)
        if !app.account.isSignedIn {
          Btn(label: "Sign in") { router.push(.account) }
        }
        Btn(label: "Scan a QR code", tone: app.account.isSignedIn ? .primary : .secondary) {
          router.push(.pair)
        }
      } else {
        SectionHeader(title: "Computers", count: app.hosts.count)
        ForEach(app.hosts) { computer in
          hostCard(computer)
        }
        if app.account.isSignedIn {
          Btn(label: "Add a computer to your account", tone: .secondary) { router.push(.addComputer) }
        }
        Btn(label: "Pair another computer", tone: .secondary) { router.push(.pair) }
      }
    }
    .navigationTitle("Computers")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func hostCard(_ computer: DeviceIdentity) -> some View {
    let active = computer.deviceId == app.activeHostId
    return Card {
      HStack(spacing: 8) {
        Image(systemName: Icon.desktop)
          .font(.system(size: 15))
          .foregroundStyle(active ? theme.accent : theme.textSecondary)
        VStack(alignment: .leading, spacing: 2) {
          BodyText(computer.label, lineLimit: 1)
          if let presence = app.presence(of: computer) {
            MutedText(
              AccountPresenceLabel.text(online: presence.online, lastSeen: presence.lastSeen), lineLimit: 1)
          } else {
            MutedText(DeviceIdentity.gatewayHost(computer.url), lineLimit: 1)
          }
        }
        Spacer(minLength: 6)
        if active {
          ConnectionBadge(state: host.connection)
        } else {
          Badge(label: "Tap to connect")
        }
        IconBtn(systemName: Icon.ellipsis, label: "\(computer.label) settings") {
          router.push(.computer(deviceId: computer.deviceId))
        }
      }
      .contentShape(Rectangle())
      .onTapGesture { open(computer) }
    }
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
