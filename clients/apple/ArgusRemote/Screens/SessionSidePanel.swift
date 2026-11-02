import ArgusUI
import SwiftUI

/// What the iPad session side panel can show, as the Mac's side panel tabs.
/// A fixed set: the Mac's are opened one by one, a touch screen wants them a tap away.
enum SessionPanelTab: String, CaseIterable, Identifiable {
  case details, changes, files, terminals, device

  var id: String { rawValue }

  var title: String {
    switch self {
    case .details: "Details"
    case .changes: "Changes"
    case .files: "Files"
    case .terminals: "Terminals"
    case .device: "Device"
    }
  }

  var symbol: String {
    switch self {
    case .details: Icon.details
    case .changes: Icon.changes
    case .files: Icon.file
    case .terminals: Icon.terminal
    case .device: Icon.simulator
    }
  }

  /// The tab a session details row opens in, when it has one.
  init?(_ route: Route) {
    switch route {
    case .changes: self = .changes
    case .quickOpen: self = .files
    case .terminals: self = .terminals
    case .devices, .device: self = .device
    default: return nil
    }
  }
}

/// The iPad session's side panel, a trailing column beside the chat: the
/// session's details, changes, files, terminals and device, each the phone's
/// own screen. What it opens stays in the panel, so the chat stays put.
///
/// Plain views with a header of its own rather than a stack: on iOS 27 a
/// second `NavigationStack` anywhere under the detail column (or an
/// `.inspector` on it) desyncs the column's stack, and toolbars from inside
/// land in the session's bar whatever hosts them.
struct SidePanelColumn: View {
  @Environment(\.theme) private var theme
  @Environment(Router.self) private var router
  let session: RemoteSession
  /// The most the chat beside it can spare.
  let maxWidth: CGFloat

  static let widths: ClosedRange<CGFloat> = 300...600
  static let headerHeight: CGFloat = 52
  @State private var dragStart: CGFloat?

  private var width: CGFloat { max(Self.widths.lowerBound, min(router.panelWidth, maxWidth)) }

  var body: some View {
    HStack(spacing: 0) {
      Rectangle().fill(theme.border).frame(width: 1)
        // Wider than it looks, so a finger can find it.
        .overlay { Color.clear.frame(width: 24).contentShape(.rect).gesture(resize) }
        .accessibilityHidden(true)
      page
        .safeAreaPadding(.top, Self.headerHeight)
        .overlayPreferenceValue(PanelBarKey.self, alignment: .top) { header($0) }
        .frame(width: width)
        .background(theme.bg)
        .clipped()
    }
    .environment(\.stackPush) { route in
      withAnimation(.snappy(duration: 0.25)) { router.panelPaths[session.id, default: []].append(route) }
    }
  }

  @ViewBuilder private var page: some View {
    if let route = router.panelPaths[session.id, default: []].last {
      RouteScreen(route: route)
        .id(router.panelPaths[session.id, default: []].count)
        .transition(.move(edge: .trailing))
    } else {
      SessionSidePanel(session: session)
    }
  }

  /// The tabs at the panel's root; back, the page's title and its items above anything opened.
  private func header(_ bar: PanelBar) -> some View {
    HStack(spacing: 8) {
      if router.panelPaths[session.id, default: []].isEmpty {
        SessionPanelTabBar(session: session)
      } else {
        Button {
          withAnimation(.snappy(duration: 0.25)) { _ = router.panelPaths[session.id, default: []].popLast() }
        } label: {
          Image(systemName: Icon.chevronLeft).font(.scaled(.body).weight(.semibold))
            .frame(width: 32, height: 32)
            .contentShape(.rect)
        }
        .buttonStyle(.argusPlain)
        .accessibilityLabel("Back")
        Group {
          if let principal = bar.principal {
            principal
          } else {
            Text(router.panelPaths[session.id, default: []].last.map(Self.title) ?? "")
              .font(.scaled(.subheadline).weight(.semibold))
              .lineLimit(1)
              .truncationMode(.middle)
          }
        }
        .frame(maxWidth: .infinity)
      }
      bar.trailing.labelStyle(.iconOnly)
    }
    .padding(.horizontal, theme.space)
    .frame(height: Self.headerHeight)
    .background(theme.bg)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.border).frame(height: 1) }
  }

  /// The header's title for what a session's panel can open; its navigation title elsewhere.
  static func title(_ route: Route) -> String {
    switch route {
    case .fileDiff(_, let path, _), .file(_, let path, _, _): SessionFilePaths.fileName(path)
    case .fileSearch: "Search"
    case .terminal(_, let label): label
    case .stashes: "Stashes & Tags"
    case .branches: "Branches"
    case .branch(_, _, let branch): branch.name
    case .commit(_, let hash, _): String(hash.prefix(8))
    case .branchCompare(_, let left, let right): "\(left) ↔ \(right)"
    case .mcpServers: "MCP Servers"
    case .devices: "Devices"
    case .device(_, _, let name, _): name
    default: ""
    }
  }

  private var resize: some Gesture {
    DragGesture(minimumDistance: 2, coordinateSpace: .global)
      .onChanged { value in
        let start = dragStart ?? width
        dragStart = start
        router.panelWidth = min(max(start - value.translation.width, Self.widths.lowerBound), Self.widths.upperBound)
      }
      .onEnded { _ in dragStart = nil }
  }
}

/// Which tabs a session's panel offers: all of them once it is set up.
private func panelTabs(_ session: RemoteSession) -> [SessionPanelTab] {
  session.status == .ready && !session.isUnavailable ? SessionPanelTab.allCases : [.details]
}

private struct SessionPanelTabBar: View {
  @Environment(Router.self) private var router
  let session: RemoteSession

  var body: some View {
    let tabs = panelTabs(session)
    let tab = tabs.contains(router.panelTab) ? router.panelTab : .details
    PillTabBar(
      tabs: tabs.map { PillTab(id: $0, title: $0.title, symbol: $0.symbol) },
      selection: tab, compact: true, iconsOnly: true
    ) { picked in
      guard picked != tab else { return }
      router.panelTab = picked
      Telemetry.capture(.sessionPanelUsed(action: .switchTab, tab: picked))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The panel's root: the tab in front.
struct SessionSidePanel: View {
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router

  let session: RemoteSession

  private var label: String { SessionActivity.title(session) }
  private var tab: SessionPanelTab {
    panelTabs(session).contains(router.panelTab) ? router.panelTab : .details
  }

  var body: some View {
    switch tab {
    case .details:
      SessionDetailsView(
        session: session, agentId: router.focusedAgents[session: session.id],
        open: open,
        started: { router.focusedAgents[session: session.id] = $0.agentId },
        deleted: { router.pop() })
    case .changes:
      ChangesView(sessionId: session.id, label: label)
    case .files:
      QuickOpenView(sessionId: session.id, label: label)
        .screenBar {
          Button {
            router.panelPaths[session.id, default: []].append(.fileSearch(sessionId: session.id, label: label))
          } label: {
            Label("Search files", systemImage: Icon.search)
          }
        }
    case .terminals:
      SessionTerminalsList(sessionId: session.id) { terminal in
        router.panelPaths[session.id, default: []].append(.terminal(id: terminal.id, label: SessionTerminalsList.title(terminal)))
      }
    case .device:
      // Straight to the device when there is only one to mean, as the details row does.
      if host.devices.count == 1, let only = host.devices.first {
        DeviceView(deviceId: only.id, platform: only.platform, name: only.name, isTv: only.isTv)
          .id(only.id)
      } else {
        DevicesView()
      }
    }
  }

  /// A details row: its own tab when it has one, else opened in the panel,
  /// except a chat, which belongs beside the others in the detail column.
  private func open(_ route: Route) {
    // One of several devices goes on top of the tab's list.
    let oneOfSeveral = if case .device = route { host.devices.count > 1 } else { false }
    if let target = SessionPanelTab(route) {
      router.panelTab = target
      router.panelPaths[session.id, default: []] = oneOfSeveral ? [route] : []
      return
    }
    switch route {
    case .stoppedAgent, .agent, .session, .issue, .design: router.push(route)
    default: router.panelPaths[session.id, default: []].append(route)
    }
  }
}
