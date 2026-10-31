import ArgusUI
import SwiftUI

/// `/more`: the phone's fifth tab — every Mac destination that has no tab of
/// its own, in the order the Mac's sidebar lists them.
struct MoreView: View {
  @Environment(AppStore.self) private var app
  @Environment(HostStore.self) private var host
  @Environment(PullRequestsStore.self) private var pullRequests

  var body: some View {
    List {
      Section {
        row(.pullRequests, badge: pullRequests.pullRequests.count, tone: .accent)
        // Only once the computer has Linear connected; the key never leaves it.
        if host.linearConnected { row(.issues) }
        row(.devices)
      }
      Section {
        row(.usage)
        row(.notifications, badge: app.notifications.unseenCount, tone: .danger)
      }
      Section {
        row(.settings)
      }
    }
    .navigationTitle("More")
    .task(id: host.connection) {
      guard host.connection == .ready, !pullRequests.loaded else { return }
      await pullRequests.refresh()
    }
  }

  private func row(_ section: AppSection, badge: Int = 0, tone: Tone = .muted) -> some View {
    NavigationLink(value: section.root) {
      LabeledContent {
        if badge > 0 { Badge(label: "\(badge)", tone: tone) }
      } label: {
        Label(section.title, systemImage: section.symbol)
      }
    }
  }
}
