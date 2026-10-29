import ArgusCore
import SwiftUI

extension View {
  /// Linear's filter menu off this view: the fields with a search, the picked
  /// field's values beside them. `field` opens straight on that field's values.
  func issueFilterMenu(
    isPresented: Binding<Bool>, field: IssueFilter.Field?, issues: [HostStore.LinearIssue],
    filters: Binding<[IssueFilter]>
  ) -> some View {
    modifier(IssueFilterMenuPresentation(isPresented: isPresented, field: field, issues: issues, filters: filters))
  }
}

private struct IssueFilterMenuPresentation: ViewModifier {
  @Environment(\.theme) private var theme
  @Binding var isPresented: Bool
  let field: IssueFilter.Field?
  let issues: [HostStore.LinearIssue]
  @Binding var filters: [IssueFilter]
  @State private var menu: IssueFilterMenu?

  func body(content: Content) -> some View {
    content
      .onChange(of: isPresented, initial: true) { _, open in
        let binding = $filters
        menu =
          open
          ? IssueFilterMenu(
            issues: issues, field: field, filters: { binding.wrappedValue }, apply: { binding.wrappedValue = $0 })
          : nil
      }
      .modifier(presentation)
  }

  private var presented: Binding<Bool> {
    Binding(get: { isPresented && menu != nil }, set: { isPresented = $0 })
  }

  @ViewBuilder private var panel: some View {
    if let menu { IssueFilterMenuView(menu: menu) { isPresented = false } }
  }

  #if os(macOS)
    private var presentation: some ViewModifier {
      FloatingPresentation(isPresented: presented, onKey: handle) { panel }
    }

    private func handle(_ key: FloatingPanelKey) -> Bool {
      guard let menu else { return false }
      switch key {
      case .up: menu.move(-1)
      case .down: menu.move(1)
      case .submit: if menu.submit() { isPresented = false }
      case .escape: return menu.back()
      case .character: return false
      }
      return true
    }
  #else
    private var presentation: some ViewModifier {
      PopoverPresentation(isPresented: presented) { panel }
    }
  #endif
}

#if os(macOS)
  private struct FloatingPresentation<Panel: View>: ViewModifier {
    @Binding var isPresented: Bool
    let onKey: (FloatingPanelKey) -> Bool
    @ViewBuilder let panel: () -> Panel

    func body(content: Content) -> some View {
      content.floatingPanel(isPresented: $isPresented, onKey: onKey, content: panel)
    }
  }
#else
  private struct PopoverPresentation<Panel: View>: ViewModifier {
    @Environment(\.theme) private var theme
    @Binding var isPresented: Bool
    @ViewBuilder let panel: () -> Panel

    func body(content: Content) -> some View {
      content.popover(isPresented: $isPresented) {
        panel()
          .presentationCompactAdaptation(.popover)
          .presentationBackground(theme.surface)
      }
    }
  }
#endif

/// The menu: on the Mac the fields and the open field's values as two
/// floating panels side by side; on the phone one at a time.
struct IssueFilterMenuView: View {
  @Bindable var menu: IssueFilterMenu
  let close: () -> Void

  var body: some View {
    #if os(macOS)
      HStack(alignment: .top, spacing: 6) {
        if menu.pinned == nil { IssueFilterFieldsPanel(menu: menu).floatingSurface() }
        if let field = menu.field { IssueFilterValuesPanel(menu: menu, field: field).floatingSurface() }
      }
    #else
      if let field = menu.field {
        IssueFilterValuesPanel(menu: menu, field: field)
      } else {
        IssueFilterFieldsPanel(menu: menu)
      }
    #endif
  }
}

private enum FilterMenuMetrics {
  static let rowHeight: CGFloat = 30
  /// Rows before the list scrolls.
  static let maxRows = 11
}

/// "Add filter…": every field with its icon and a chevron to its values.
private struct IssueFilterFieldsPanel: View {
  @Environment(\.theme) private var theme
  @Bindable var menu: IssueFilterMenu
  @FocusState private var searching: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      FilterSearchField(placeholder: "Add filter…", text: $menu.fieldQuery, focused: $searching)
      Rectangle().fill(theme.border).frame(height: 1)
      VStack(alignment: .leading, spacing: 0) {
        let groups = menu.fieldGroups
        ForEach(groups.indices, id: \.self) { index in
          if index > 0 { Rectangle().fill(theme.border).frame(height: 1).padding(.vertical, 4) }
          ForEach(groups[index]) { row($0) }
        }
        if groups.isEmpty { FilterMenuNote("No matching filters") }
      }
      .padding(4)
    }
    .frame(width: 232)
    .onAppear { focusOnMac() }
    .onChange(of: menu.field) { _, field in if field == nil { focusOnMac() } }
  }

  private func focusOnMac() {
    #if os(macOS)
      searching = true
    #endif
  }

  private func row(_ field: IssueFilter.Field) -> some View {
    let lit = menu.highlightedField == field || menu.field == field
    return Button {
      menu.open(field)
    } label: {
      HStack(spacing: 10) {
        Image(systemName: field.symbol)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textSecondary)
          .frame(width: 16)
        Text(field.label).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(1)
        Spacer(minLength: 12)
        Image(systemName: Icon.chevronRight)
          .font(.scaled(size: 9, weight: .semibold))
          .foregroundStyle(theme.textMuted)
      }
      .padding(.horizontal, 8)
      .frame(height: FilterMenuMetrics.rowHeight)
      .background { if lit { RoundedRectangle(cornerRadius: 6).fill(theme.selection) } }
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .onHover { if $0 { menu.highlightedField = field } }
    .accessibilityLabel("Filter by \(field.label)")
  }
}

/// One field's values: tick as many as should match, each with how many issues it keeps.
private struct IssueFilterValuesPanel: View {
  @Environment(\.theme) private var theme
  @Bindable var menu: IssueFilterMenu
  let field: IssueFilter.Field
  @FocusState private var searching: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 6) {
        #if os(iOS)
          if menu.pinned == nil {
            Button {
              _ = menu.back()
            } label: {
              Image(systemName: Icon.chevronLeft).font(.scaled(size: 11, weight: .semibold))
            }
            .buttonStyle(.argusPlain)
            .foregroundStyle(theme.textSecondary)
            .accessibilityLabel("Back to filters")
          }
        #endif
        FilterSearchField(
          placeholder: field.isText ? "\(field.label) contains…" : "Filter…", text: $menu.valueQuery,
          focused: $searching)
      }
      Rectangle().fill(theme.border).frame(height: 1)
      if field.isText {
        FilterMenuNote("Press Return to filter on this text.").padding(4)
      } else {
        options
      }
    }
    .frame(width: 280)
    .id(field)
    .onAppear {
      #if os(macOS)
        searching = true
      #endif
    }
  }

  @ViewBuilder private var options: some View {
    let split = menu.options
    let shown = split.shown
    let unmatched = split.unmatched
    let picked = menu.picked
    let list = VStack(alignment: .leading, spacing: 0) {
      ForEach(shown) { row($0, on: picked.contains($0.value)).id($0.value) }
      if shown.isEmpty { FilterMenuNote(menu.valueQuery.isEmpty ? "No options" : "No matches") }
    }
    .padding(4)
    if shown.count > FilterMenuMetrics.maxRows {
      ScrollViewReader { proxy in
        ScrollView { list }
          .frame(height: CGFloat(FilterMenuMetrics.maxRows) * FilterMenuMetrics.rowHeight + 8)
          .onChange(of: menu.highlightedValue) { _, value in if let value { proxy.scrollTo(value) } }
      }
    } else {
      list
    }
    if !unmatched.isEmpty {
      Rectangle().fill(theme.border).frame(height: 1)
      Button {
        menu.showsUnmatched = true
      } label: {
        Text("\(unmatched.count) option\(unmatched.count == 1 ? "" : "s") not matching any issues")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
          .padding(.horizontal, 12)
          .frame(maxWidth: .infinity, minHeight: FilterMenuMetrics.rowHeight, alignment: .leading)
          .contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
      .help("Show them too")
    }
  }

  private func row(_ option: IssueFilter.Option, on: Bool) -> some View {
    Button {
      menu.toggle(option.value)
    } label: {
      HStack(spacing: 10) {
        FilterOptionCheck(on: on)
        FilterValueIcon(field: field, value: option.value, issues: menu.issues).frame(width: 16)
        Text(option.label).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(1)
        Spacer(minLength: 12)
        Text("\(option.count) issue\(option.count == 1 ? "" : "s")")
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
          .monospacedDigit()
      }
      .padding(.horizontal, 8)
      .frame(height: FilterMenuMetrics.rowHeight)
      .background {
        if menu.highlightedValue == option.value { RoundedRectangle(cornerRadius: 6).fill(theme.selection) }
      }
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .onHover { if $0 { menu.highlightedValue = option.value } }
    .accessibilityLabel("\(option.label), \(option.count) issues")
    .accessibilityAddTraits(on ? .isSelected : [])
  }
}

/// What a value looks like in Linear: its status circle, priority bars, avatar or label colour.
private struct FilterValueIcon: View {
  @Environment(\.theme) private var theme
  let field: IssueFilter.Field
  let value: String
  let issues: [HostStore.LinearIssue]

  var body: some View {
    switch field {
    case .status:
      let state = issues.first { $0.state.name == value }?.state
      IssueStatusGlyph(type: state?.type ?? "unstarted", color: state?.color)
    case .statusType:
      IssueStatusGlyph(type: value)
    case .priority:
      PriorityGlyph(priority: Int(value) ?? 0)
    case .assignee where value != IssueFilters.none:
      LinearAvatar(name: value, url: issues.first { $0.assignee == value }?.assigneeAvatarUrl, size: 16)
    case .creator where value != IssueFilters.none:
      LinearAvatar(name: value, url: nil, size: 16)
    case .labels where value != IssueFilters.none:
      let hex = issues.lazy.compactMap { $0.labelColors?.first { $0.name == value }?.color }.first
      Circle().fill(Color(linearHex: hex) ?? theme.textMuted).frame(width: 8, height: 8)
    default:
      Image(systemName: field.symbol).font(.scaled(size: 12)).foregroundStyle(theme.textSecondary)
    }
  }
}

private struct FilterSearchField: View {
  @Environment(\.theme) private var theme
  let placeholder: String
  @Binding var text: String
  var focused: FocusState<Bool>.Binding

  var body: some View {
    TextField(placeholder, text: $text)
      .textFieldStyle(.plain)
      .font(.scaled(size: 13))
      .foregroundStyle(theme.text)
      .focused(focused)
      .padding(.horizontal, 12)
      .frame(height: 36)
  }
}

private struct FilterMenuNote: View {
  @Environment(\.theme) private var theme
  let text: String

  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text)
      .font(.scaled(size: 12))
      .foregroundStyle(theme.textMuted)
      .padding(.horizontal, 8)
      .frame(minHeight: 28, alignment: .leading)
  }
}

private struct FilterOptionCheck: View {
  @Environment(\.theme) private var theme
  let on: Bool

  var body: some View {
    RoundedRectangle(cornerRadius: 4)
      .fill(on ? theme.accent : Color.clear)
      .overlay {
        if on {
          Image(systemName: Icon.check)
            .font(.system(size: 8, weight: .bold))
            .foregroundStyle(theme.onAccent)
        } else {
          RoundedRectangle(cornerRadius: 4).strokeBorder(theme.borderStrong, lineWidth: 1)
        }
      }
      .frame(width: 13, height: 13)
  }
}

extension IssueFilter.Field {
  /// The field's icon in the filter menu, after Linear's.
  var symbol: String {
    switch self {
    case .team: "person.3"
    case .status: "circle.dashed"
    case .statusType: "circle.lefthalf.filled"
    case .assignee: Icon.person
    case .creator: "person.crop.circle.badge.plus"
    case .priority: "chart.bar"
    case .estimate: "triangle"
    case .labels: "tag"
    case .relations: "arrow.triangle.branch"
    case .due: "calendar"
    case .created: "calendar.badge.plus"
    case .updated: "clock.arrow.circlepath"
    case .project: "cube"
    case .cycle: "arrow.triangle.2.circlepath"
    case .links: Icon.link
    case .content: "text.magnifyingglass"
    }
  }
}
