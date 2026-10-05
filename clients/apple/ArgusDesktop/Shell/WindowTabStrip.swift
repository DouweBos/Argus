import ArgusCore
import ArgusUI
import SwiftUI

/// The window's tabs, shown once there is more than the pinned "This Mac" —
/// how two machines' screens stay apart in one window.
struct WindowTabStrip: View {
  @Environment(DesktopModel.self) private var model
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme

  var body: some View {
    if model.tabs.count > 1 {
      HStack(spacing: 4) {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 4) {
            ForEach(model.tabs) { tab in
              TabChip(
                title: model.title(of: tab), host: host(of: tab), active: tab.id == model.activeTabId,
                closable: !tab.pinned
              ) {
                model.switchTab(tab.id)
              } close: {
                model.closeTab(tab.id)
              }
            }
          }
        }
        Button {
          model.openTab()
        } label: {
          Image(systemName: "plus")
        }
        .buttonStyle(.borderless)
        .help("New Tab")
        .accessibilityLabel("New Tab")
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background(theme.bgSecondary)
      .overlay(alignment: .bottom) { Divider() }
    }
  }

  private func host(of tab: WindowTab) -> HostId {
    let location = tab.id == model.activeTabId ? model.location : tab.location
    return location.route.sessionId.map(model.host(ofSession:)) ?? location.host ?? Hosts.local
  }
}

private struct TabChip: View {
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme
  let title: String
  let host: HostId
  let active: Bool
  let closable: Bool
  let select: () -> Void
  let close: () -> Void

  var body: some View {
    HStack(spacing: 6) {
      Button(action: select) {
        HStack(spacing: 6) {
          if host != Hosts.local { StatusDot(tone: hosts.state(host).tone) }
          Text(title).lineLimit(1)
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Tab \(title)")
      if closable {
        Button(action: close) {
          Image(systemName: "xmark").font(.scaled(size: 9, weight: .semibold))
        }
        .buttonStyle(.borderless)
        .help("Close Tab")
        .accessibilityLabel("Close tab \(title)")
      }
    }
    .font(.scaled(.callout))
    .padding(.horizontal, 10)
    .padding(.vertical, 4)
    .frame(maxWidth: 220)
    .background(active ? theme.bgHover : .clear, in: .rect(cornerRadius: theme.radiusSmall))
    .foregroundStyle(active ? theme.text : theme.textSecondary)
  }
}
