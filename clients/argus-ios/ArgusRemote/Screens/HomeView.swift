import ArgusKit
import SwiftUI

/// The computers this phone is paired with. Picking one connects to it — only
/// one at a time — and opens its projects.
struct HomeView: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router


  var body: some View {
    Screen {
      if !app.loaded {
        Loading(label: "Unlocking…")
      } else if app.hosts.isEmpty {
        EmptyState(
          icon: Icon.desktop,
          title: "No computers paired",
          body: """
            Pair with Argus on your Mac to drive its agents from here. Open \
            Settings → Remote Access on the computer to get a code.
            """)
        Btn(label: "Pair a computer") { router.push(.pair) }
      } else {
        SectionHeader(title: "Computers", count: app.hosts.count)
        ForEach(app.hosts) { host in
          hostCard(host)
        }
        Btn(label: "Pair another computer", tone: .secondary) { router.push(.pair) }
      }
    }
    .navigationTitle("Computers")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func hostCard(_ host: DeviceIdentity) -> some View {
    let active = host.deviceId == app.activeHostId
    return Card {
      HStack(spacing: 8) {
        Image(systemName: Icon.desktop)
          .font(.system(size: 15))
          .foregroundStyle(active ? theme.accent : theme.textSecondary)
        VStack(alignment: .leading, spacing: 2) {
          BodyText(host.label, lineLimit: 1)
          MutedText(DeviceIdentity.gatewayHost(host.url), lineLimit: 1)
        }
        Spacer(minLength: 6)
        if active {
          ConnectionBadge(state: app.connection)
        } else {
          Badge(label: "Tap to connect")
        }
        IconBtn(systemName: Icon.ellipsis, label: "\(host.label) settings") {
          router.push(.computer(deviceId: host.deviceId))
        }
      }
      .contentShape(Rectangle())
      .onTapGesture { open(host) }
    }
  }

  /// Navigate first, connect second.
  ///
  /// Racing every endpoint takes seconds, and awaiting it here made a tap on
  /// a connecting machine look dead — while launch, which pushes straight
  /// through, showed a perfectly good loading state. The projects screen
  /// already handles "not connected yet", so let it.
  private func open(_ host: DeviceIdentity) {
    Task { await app.selectHost(host.deviceId) }
    // Projects is the tab's root, so returning to it is a pop, not a push.
    router.popToRoot()
  }
}
