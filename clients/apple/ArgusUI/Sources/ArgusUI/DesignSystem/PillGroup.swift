import SwiftUI

/// A toolbar control drawn as a `PillTabBar` tab: flat, the same type and
/// height, highlighted on hover. Its group supplies the one capsule around it.
public struct PillItemButtonStyle: ButtonStyle {
  /// An icon alone gets a fixed width, so a group can tell what fits.
  var iconOnly: Bool

  public init(iconOnly: Bool = true) {
    self.iconOnly = iconOnly
  }

  public func makeBody(configuration: Configuration) -> some View {
    PillItem(label: configuration.label, pressed: configuration.isPressed, iconOnly: iconOnly)
  }
}

/// Metrics a toolbar pill shares with `PillTabBar`'s compact tabs.
public enum PillMetrics {
  public static let fontSize: CGFloat = 13
  public static let verticalPadding: CGFloat = 5
  public static let titledPadding: CGFloat = 12
  /// An icon-only item's width, before the text scale.
  public static let iconWidth: CGFloat = 30
  public static let spacing: CGFloat = 2

  /// How many of `count` icon-only items fit in `width` beside a More menu
  /// for the rest; all of them when they fit without one, unless the menu
  /// is always there.
  public static func visibleCount(
    _ count: Int, in width: CGFloat, scale: CGFloat = 1, alwaysMore: Bool = false
  ) -> Int {
    let item = (iconWidth + spacing) * scale
    guard width.isFinite, item > 0 else { return count }
    if !alwaysMore && CGFloat(count) * item - spacing * scale <= width { return count }
    let fitting = Int(((width - iconWidth * scale) / item).rounded(.down))
    return min(max(fitting, 0), count)
  }
}

private struct PillItem<Label: View>: View {
  @Environment(\.theme) private var theme
  @Environment(\.isEnabled) private var isEnabled
  let label: Label
  let pressed: Bool
  let iconOnly: Bool
  @State private var hovering = false

  var body: some View {
    label
      .font(.scaled(size: PillMetrics.fontSize, weight: .medium))
      .lineLimit(1)
      .fixedSize()
      .padding(.horizontal, iconOnly ? 0 : PillMetrics.titledPadding)
      .frame(width: iconOnly ? TextScale.shared(PillMetrics.iconWidth) : nil)
      .padding(.vertical, PillMetrics.verticalPadding)
      .foregroundStyle(isEnabled ? theme.text : theme.textMuted)
      .background {
        if isEnabled && (hovering || pressed) {
          Capsule().fill(pressed ? theme.borderStrong : theme.bgHover)
        }
      }
      .contentShape(Capsule())
      .onHover { hovering = $0 }
  }
}

/// One capsule of toolbar controls, as the toolbar draws around `PillTabBar`:
/// put it in a single toolbar item and its buttons render as flat pill items.
public struct PillGroup<Content: View>: View {
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    HStack(spacing: PillMetrics.spacing) {
      content
    }
    .buttonStyle(PillItemButtonStyle())
    .labelStyle(.iconOnly)
    .fixedSize()
  }
}

/// A pill item's count: people waiting, unread messages.
public struct PillBadge: View {
  @Environment(\.theme) private var theme
  let count: Int

  public init(_ count: Int) {
    self.count = count
  }

  public var body: some View {
    if count > 0 {
      Text(count, format: .number)
        .font(.scaled(size: 9, weight: .bold, design: .rounded))
        .foregroundStyle(theme.onAccent)
        .padding(.horizontal, 4)
        .frame(minWidth: 14, minHeight: 14)
        .background(Capsule().fill(theme.accent))
        .offset(x: 4, y: -3)
        .allowsHitTesting(false)
    }
  }
}

/// One action a pill group can show as an item or list in its More menu.
public struct PillAction: Identifiable {
  public var id: String
  public var title: String
  public var symbol: String
  public var help: String
  public var disabled: Bool
  public var run: () -> Void

  public init(
    id: String, title: String, symbol: String, help: String? = nil, disabled: Bool = false,
    run: @escaping () -> Void
  ) {
    self.id = id
    self.title = title
    self.symbol = symbol
    self.help = help ?? title
    self.disabled = disabled
    self.run = run
  }
}

/// Icon actions in one capsule, as many as `width` allows; the rest go in a
/// More menu at the end, as a toolbar overflows. `menu` actions always live there.
public struct PillActionGroup<Leading: View>: View {
  let actions: [PillAction]
  let menu: [PillAction]
  let width: CGFloat
  let leading: Leading

  public init(
    actions: [PillAction], menu: [PillAction] = [], width: CGFloat = .infinity, @ViewBuilder leading: () -> Leading
  ) {
    self.actions = actions
    self.menu = menu
    self.width = width
    self.leading = leading()
  }

  public var body: some View {
    let shown = PillMetrics.visibleCount(
      actions.count, in: width, scale: TextScale.shared.factor, alwaysMore: !menu.isEmpty)
    PillGroup {
      leading
      ForEach(actions.prefix(shown)) { action in
        Button(action: action.run) { Label(action.title, systemImage: action.symbol) }
          .disabled(action.disabled)
          .help(action.help)
          .accessibilityLabel(action.title)
      }
      if shown < actions.count || !menu.isEmpty {
        Menu {
          ForEach(actions.dropFirst(shown)) { item($0) }
          if shown < actions.count && !menu.isEmpty { Divider() }
          ForEach(menu) { item($0) }
        } label: {
          Label("More", systemImage: "ellipsis")
        }
        .menuStyle(.button)
        .menuIndicator(.hidden)
        .help("More")
        .accessibilityLabel("More")
      }
    }
  }

  private func item(_ action: PillAction) -> some View {
    Button(action: action.run) { Label(action.title, systemImage: action.symbol) }
      .disabled(action.disabled)
  }
}

extension PillActionGroup where Leading == EmptyView {
  public init(actions: [PillAction], menu: [PillAction] = [], width: CGFloat = .infinity) {
    self.init(actions: actions, menu: menu, width: width) { EmptyView() }
  }
}

#Preview {
  VStack(spacing: 16) {
    PillGroup {
      Button {} label: { Label("Share", systemImage: "person.2") }
        .overlay(alignment: .topTrailing) { PillBadge(2) }
      Button {} label: { Label("Dev", systemImage: "play.fill") }
        .buttonStyle(PillItemButtonStyle(iconOnly: false))
        .labelStyle(.titleAndIcon)
      Button {} label: { Label("Terminal", systemImage: "terminal") }
      Button {} label: { Label("Device", systemImage: "iphone") }
    }
    PillActionGroup(
      actions: ["Fetch", "Pull", "Push", "Branch", "Stash", "Tag"].map { title in
        PillAction(id: title, title: title, symbol: "circle") {}
      },
      width: 140)
  }
  .padding()
}
