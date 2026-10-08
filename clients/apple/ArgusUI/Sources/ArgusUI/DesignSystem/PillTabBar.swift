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
public struct PillTabBar<ID: Hashable>: View {
  @Environment(\.theme) private var theme
  let tabs: [PillTab<ID>]
  let selection: ID?
  /// Smaller type and padding, to sit in a window toolbar.
  var compact: Bool
  /// Unselected tabs show only their icon, for narrow windows.
  var iconsOnly: Bool
  let onSelect: (ID) -> Void

  @Namespace private var namespace

  public init(
    tabs: [PillTab<ID>], selection: ID?, compact: Bool = false, iconsOnly: Bool = false,
    onSelect: @escaping (ID) -> Void
  ) {
    self.tabs = tabs
    self.selection = selection
    self.compact = compact
    self.iconsOnly = iconsOnly
    self.onSelect = onSelect
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
        .buttonStyle(.plain)
        .help(tab.title)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
      }
    }
    .animation(.snappy(duration: 0.25), value: selection)
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
