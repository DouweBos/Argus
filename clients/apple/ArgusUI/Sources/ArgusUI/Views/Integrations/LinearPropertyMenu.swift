import ArgusCore
import ArgusKit
import SwiftUI

/// An enum property (status, priority) as Linear draws it: a pill that opens a
/// searchable menu of its values, number keys on the right. On the Mac it floats
/// in the context card's surface; on the phone it's a popover.
struct LinearPropertyPill<Label: View>: View {
  @Environment(\.theme) private var theme
  let options: [LinearIssueProperty.Option]
  let current: String
  /// "Change status…"
  let placeholder: String
  /// The page key that opens it, shown in the search field.
  let key: String
  @Binding var isOpen: Bool
  let icon: (String) -> AnyView
  let pick: (String) -> Void
  @ViewBuilder let label: () -> Label
  @State private var menu: LinearPropertyMenu?
  @State private var hovering = false

  var body: some View {
    Button {
      isOpen = true
    } label: {
      HStack(spacing: 8) {
        label()
        Spacer(minLength: 4)
        Image(systemName: Icon.chevronDown).font(.scaled(size: 10, weight: .semibold)).foregroundStyle(theme.textMuted)
      }
      .padding(.horizontal, 7)
      .frame(minHeight: TextScale.shared(26))
      .background(RoundedRectangle(cornerRadius: 7).fill(filled ? theme.selection : .clear))
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .onHover { hovering = $0 }
    .onChange(of: isOpen, initial: true) { _, open in
      if open {
        let menu = LinearPropertyMenu(options: options)
        menu.highlighted = current
        self.menu = menu
      } else {
        menu = nil
      }
    }
    .modifier(presentation)
  }

  private var filled: Bool { hovering || isOpen }

  private var presented: Binding<Bool> {
    Binding(get: { isOpen && menu != nil }, set: { isOpen = $0 })
  }

  private var presentation: some ViewModifier {
    MenuPresentation(isPresented: presented, onKey: handle) {
      if let menu {
        LinearPropertyMenuView(
          menu: menu, placeholder: placeholder, key: key, current: current, icon: icon, pick: choose)
      }
    }
  }

  private func choose(_ option: LinearIssueProperty.Option) {
    isOpen = false
    pick(option.id)
  }

  private func handle(_ key: LinearPropertyMenuKey) -> Bool {
    guard let menu else { return false }
    switch key {
    case .up: menu.move(-1)
    case .down: menu.move(1)
    case .submit: if let option = menu.submission { choose(option) }
    case .character(let typed):
      guard let option = menu.option(forKey: typed) else { return false }
      choose(option)
    }
    return true
  }
}

enum LinearPropertyMenuKey {
  case up, down, submit
  case character(Character)
}

private struct MenuPresentation<Menu: View>: ViewModifier {
  @Environment(\.theme) private var theme
  @Binding var isPresented: Bool
  let onKey: (LinearPropertyMenuKey) -> Bool
  @ViewBuilder let menu: () -> Menu

  func body(content: Content) -> some View {
    #if os(macOS)
      content.floatingPanel(isPresented: $isPresented, onKey: forward) {
        menu().floatingSurface()
      }
    #else
      content.popover(isPresented: $isPresented) {
        menu()
          .presentationCompactAdaptation(.popover)
          .presentationBackground(theme.surface)
      }
    #endif
  }

  #if os(macOS)
    private func forward(_ key: FloatingPanelKey) -> Bool {
      switch key {
      case .up: onKey(.up)
      case .down: onKey(.down)
      case .submit: onKey(.submit)
      case .escape: false
      case .character(let typed): onKey(.character(typed))
      }
    }
  #endif
}

/// The menu itself: a search field, then the values with the current one ticked.
struct LinearPropertyMenuView: View {
  @Environment(\.theme) private var theme
  @Bindable var menu: LinearPropertyMenu
  let placeholder: String
  let key: String
  let current: String
  let icon: (String) -> AnyView
  let pick: (LinearIssueProperty.Option) -> Void
  @FocusState private var searching: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        TextField(placeholder, text: $menu.query)
          .textFieldStyle(.plain)
          .font(.scaled(size: 13))
          .focused($searching)
        #if os(macOS)
          KeyHint(key).foregroundStyle(theme.textMuted)
        #endif
      }
      .padding(.horizontal, 12)
      .frame(height: 36)
      Rectangle().fill(theme.border).frame(height: 1)
      VStack(alignment: .leading, spacing: 0) {
        ForEach(menu.visible) { row($0) }
        if menu.visible.isEmpty {
          Text("No matches")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
            .padding(.horizontal, 8)
            .frame(height: 28)
        }
      }
      .padding(4)
    }
    .frame(width: 232)
    .onAppear {
      #if os(macOS)
        searching = true
      #endif
    }
  }

  private func row(_ option: LinearIssueProperty.Option) -> some View {
    Button {
      pick(option)
    } label: {
      HStack(spacing: 10) {
        icon(option.id).frame(width: 16)
        Text(option.title).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(1)
        Spacer(minLength: 12)
        if option.id == current {
          Image(systemName: Icon.check)
            .font(.scaled(size: 11, weight: .semibold))
            .foregroundStyle(theme.text)
        }
        #if os(macOS)
          Text(option.key.map { String($0) } ?? "")
            .font(.scaled(size: 12, design: .monospaced))
            .foregroundStyle(theme.textMuted)
            .frame(width: 12, alignment: .trailing)
        #endif
      }
      .padding(.horizontal, 8)
      .frame(height: 30)
      .background {
        if menu.highlighted == option.id { RoundedRectangle(cornerRadius: 6).fill(theme.selection) }
      }
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .onHover { if $0 { menu.highlighted = option.id } }
    .accessibilityLabel(option.title)
    .accessibilityAddTraits(option.id == current ? .isSelected : [])
  }
}

/// "Time in status": each status the issue has been in, with how long, the current one emphasized.
struct LinearTimeInStatusCard: View {
  @Environment(\.theme) private var theme
  let issue: HostStore.LinearIssueDetail
  /// The team's workflow, for each status's colour.
  let states: [HostStore.LinearWorkflowState]
  let canEdit: Bool

  private var stints: [LinearIssueProperty.Stint] {
    let history = issue.statusHistory ?? []
    let entries = history.isEmpty
      ? [.init(name: issue.state.name, type: issue.state.type, enteredAt: issue.createdAt)] : history
    return LinearIssueProperty.timeInStatus(entries)
  }

  var body: some View {
    LinearHoverCard {
      Text("Time in status").font(.scaled(size: 13, weight: .medium)).foregroundStyle(theme.text)
        .padding(.bottom, 4)
      ForEach(stints, id: \.name) { stint in
        let isCurrent = stint.name == issue.state.name
        HStack(spacing: 10) {
          IssueStatusGlyph(type: stint.type, color: states.first { $0.name == stint.name }?.color)
          Text(stint.name).foregroundStyle(isCurrent ? theme.text : theme.textMuted).lineLimit(1)
          Spacer(minLength: 16)
          Text(LinearIssueProperty.shortDuration(stint.duration)).foregroundStyle(theme.textMuted)
        }
        .font(.scaled(size: 13, weight: isCurrent ? .medium : .regular))
        .frame(height: 26)
      }
      if canEdit {
        Rectangle().fill(theme.border).frame(height: 1).padding(.vertical, 6)
        HStack {
          Text("Change status").font(.scaled(size: 13)).foregroundStyle(theme.text)
          Spacer(minLength: 16)
          KeyHint("S").foregroundStyle(theme.textMuted)
        }
        .frame(height: 24)
      }
    }
  }
}

/// Who last changed a property, and when.
struct LinearLastChangeCard: View {
  @Environment(\.theme) private var theme
  let kind: LinearIssueProperty.Kind
  let history: [ArgusProtocol.LinearHistoryEvent]?

  var body: some View {
    LinearHoverCard {
      if let change = LinearIssueProperty.lastChange(kind, in: history) {
        Text("Changed by \(change.actor ?? "Linear") · \(Labels.timeAgo(change.createdAt))")
      } else {
        Text("Set when the issue was created")
      }
    }
    .font(.scaled(size: 12))
    .foregroundStyle(theme.textSecondary)
  }
}

private struct LinearHoverCard<Content: View>: View {
  @ViewBuilder let content: () -> Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0) { content() }
      .padding(.horizontal, 12)
      .padding(.vertical, 10)
      .frame(minWidth: 180, alignment: .leading)
      .fixedSize()
      .floatingSurface()
  }
}

extension View {
  /// On the Mac, a card that floats beside this view after the pointer rests on it. Nothing on touch.
  @ViewBuilder
  func propertyHoverCard(enabled: Bool = true, @ViewBuilder card: @escaping () -> some View) -> some View {
    #if os(macOS)
      hoverCard(placement: .leading, enabled: enabled, card: card)
    #else
      self
    #endif
  }
}
