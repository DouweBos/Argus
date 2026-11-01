import SwiftUI

/// One tab of a `PillTabBar`.
public struct PillTab<ID: Hashable>: Identifiable {
  public var id: ID
  public var title: String
  public var symbol: String
  public var badge: Int?
  /// A small dot: something behind this tab needs attention.
  public var indicator: Bool

  public init(id: ID, title: String, symbol: String, badge: Int? = nil, indicator: Bool = false) {
    self.id = id
    self.title = title
    self.symbol = symbol
    self.badge = badge
    self.indicator = indicator
  }
}

/// Top-level tab switcher, as Grove's: the selected tab is a filled pill that
/// slides between tabs.
public struct PillTabBar<ID: Hashable, Trailing: View>: View {
  @Environment(\.theme) private var theme
  let tabs: [PillTab<ID>]
  let selection: ID?
  /// Smaller type and padding, to sit in a window toolbar.
  var compact: Bool
  /// Unselected tabs show only their icon, for narrow windows.
  var iconsOnly: Bool
  /// Its own capsule around the tabs, where no toolbar draws one (a panel's header).
  var framed: Bool
  let onSelect: (ID) -> Void
  /// Controls after the tabs inside the same capsule, e.g. a More menu.
  let trailing: Trailing
  /// A long-press / right-click menu per tab, when set.
  var tabMenu: ((ID) -> AnyView)?

  @Namespace private var namespace

  public init(
    tabs: [PillTab<ID>], selection: ID?, compact: Bool = false, iconsOnly: Bool = false, framed: Bool = false,
    onSelect: @escaping (ID) -> Void, @ViewBuilder trailing: () -> Trailing
  ) {
    self.tabs = tabs
    self.selection = selection
    self.compact = compact
    self.iconsOnly = iconsOnly
    self.framed = framed
    self.onSelect = onSelect
    self.trailing = trailing()
  }

  public var body: some View {
    HStack(spacing: 4) {
      ForEach(tabs) { tab in
        let isSelected = tab.id == selection
        Button {
          onSelect(tab.id)
        } label: {
          HStack(spacing: 6) {
            if iconsOnly && !isSelected {
              Image(systemName: tab.symbol)
            } else {
              Label(tab.title, systemImage: tab.symbol).labelStyle(.titleAndIcon)
            }
            if tab.indicator {
              Circle().fill(theme.error).frame(width: 6, height: 6)
                .accessibilityLabel("Needs attention")
            }
            if let badge = tab.badge, badge > 0 {
              Text(badge, format: .number)
                .font(.scaled(size: 11, weight: .semibold, design: .rounded))
                .padding(.horizontal, 5)
                .background(Capsule().fill(isSelected ? theme.pillSelectedText.opacity(0.2) : theme.bgTertiary))
            }
          }
          .fixedSize()
          .font(.scaled(size: compact ? 13 : 14, weight: .medium))
          .padding(.horizontal, compact ? 12 : 16)
          .padding(.vertical, compact ? 5 : 8)
          .foregroundStyle(isSelected ? theme.pillSelectedText : theme.text)
          .background {
            if isSelected {
              Capsule().fill(theme.pillSelected).matchedGeometryEffect(id: "pill", in: namespace)
            }
          }
          .contentShape(Capsule())
        }
        .buttonStyle(.argusPlain)
        .modifier(TabMenu(menu: tabMenu.map { menu in { menu(tab.id) } }))
        .help(tab.title)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        // So a scroll view around the bar can bring the selected tab into view.
        .id(tab.id)
      }
      trailing
        .buttonStyle(PillItemButtonStyle(iconOnly: false))
    }
    .padding(framed ? 3 : 0)
    .background {
      if framed {
        Capsule().fill(theme.bgSecondary).overlay(Capsule().strokeBorder(theme.border, lineWidth: 1))
      }
    }
    .animation(.snappy(duration: 0.25), value: selection)
  }
}

extension PillTabBar {
  /// Give each tab a context menu.
  public func tabContextMenu<Menu: View>(@ViewBuilder _ menu: @escaping (ID) -> Menu) -> Self {
    var copy = self
    copy.tabMenu = { AnyView(menu($0)) }
    return copy
  }
}

private struct TabMenu: ViewModifier {
  let menu: (() -> AnyView)?

  func body(content: Content) -> some View {
    if let menu { content.contextMenu { menu() } } else { content }
  }
}

extension PillTabBar where Trailing == EmptyView {
  public init(
    tabs: [PillTab<ID>], selection: ID?, compact: Bool = false, iconsOnly: Bool = false, framed: Bool = false,
    onSelect: @escaping (ID) -> Void
  ) {
    self.init(
      tabs: tabs, selection: selection, compact: compact, iconsOnly: iconsOnly, framed: framed, onSelect: onSelect
    ) { EmptyView() }
  }
}

#Preview {
  @Previewable @State var selection = "agents"
  PillTabBar(
    tabs: [
      PillTab(id: "home", title: "Home", symbol: "house"),
      PillTab(id: "agents", title: "Agents", symbol: "sparkles", badge: 3),
      PillTab(id: "git", title: "Git", symbol: "arrow.triangle.branch", indicator: true),
    ],
    selection: selection
  ) { selection = $0 }
  .padding()
}

#Preview("Framed, icons only") {
  @Previewable @State var selection = "simulate"
  PillTabBar(
    tabs: [
      PillTab(id: "simulate", title: "Simulate", symbol: "iphone"),
      PillTab(id: "inspect", title: "Inspect", symbol: "viewfinder"),
      PillTab(id: "logs", title: "Logs", symbol: "text.alignleft"),
    ],
    selection: selection, compact: true, iconsOnly: true, framed: true
  ) { selection = $0 }
  .padding()
}

#Preview("Framed, with a More menu") {
  @Previewable @State var selection = "changes"
  PillTabBar(
    tabs: [
      PillTab(id: "changes", title: "Changes", symbol: "tray", badge: 4),
      PillTab(id: "history", title: "History", symbol: "clock"),
    ],
    selection: selection, compact: true, framed: true
  ) {
    selection = $0
  } trailing: {
    Menu {
      Button("Reflog") {}
    } label: {
      Label("More", systemImage: "ellipsis.circle").labelStyle(.titleAndIcon)
    }
    .menuStyle(.button)
    .menuIndicator(.hidden)
  }
  .padding()
}
