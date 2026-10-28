import ArgusCore
import SwiftUI

/// Linear's filter row: Filter, a chip per active filter, Clear — the
/// desktop's `IssueFilterBar`.
public struct IssueFilterBar: View {
  /// The unfiltered issues, so each option shows how many it would match.
  let issues: [HostStore.LinearIssue]
  @Binding var filters: [IssueFilter]
  @State private var adding = false

  public init(issues: [HostStore.LinearIssue], filters: Binding<[IssueFilter]>) {
    self.issues = issues
    _filters = filters
  }

  public var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        Button {
          adding = true
        } label: {
          Label("Filter", systemImage: Icon.filter)
        }
        .buttonStyle(FilterBarButtonStyle())
        .help("Filter the issues like in Linear")
        .filterMenu(isPresented: $adding, field: nil, issues: issues, filters: $filters)
        ForEach(filters, id: \.field) { filter in
          IssueFilterChip(filter: filter, issues: issues, filters: $filters)
        }
        if !filters.isEmpty {
          Button("Clear") { filters = [] }
            .buttonStyle(FilterBarButtonStyle())
            .help("Remove every filter")
        }
      }
      .padding(.vertical, 1)
    }
    .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
  }
}

/// One filter: field · is / is not (click flips) · values (click edits) · ×.
private struct IssueFilterChip: View {
  @Environment(\.theme) private var theme
  let filter: IssueFilter
  let issues: [HostStore.LinearIssue]
  @Binding var filters: [IssueFilter]
  @State private var editing = false

  var body: some View {
    HStack(spacing: 0) {
      Text(filter.field.label)
        .foregroundStyle(theme.textSecondary)
        .padding(.horizontal, 8)
      separator
      Button(IssueFilters.operatorLabel(filter)) {
        filters = IssueFilters.updating(filters, filter.field) { $0.negating() }
      }
      .buttonStyle(ChipSegmentStyle(muted: true))
      .help("Flip between is and is not")
      separator
      Button(IssueFilters.summary(filter)) { editing = true }
        .buttonStyle(ChipSegmentStyle(muted: false))
        .help("Change the values")
        .filterMenu(isPresented: $editing, field: filter.field, issues: issues, filters: $filters)
      separator
      Button {
        filters = IssueFilters.updating(filters, filter.field) { _ in nil }
      } label: {
        Image(systemName: Icon.close).font(.scaled(size: 9, weight: .semibold))
      }
      .buttonStyle(ChipSegmentStyle(muted: true))
      .help("Remove the filter")
      .accessibilityLabel("Remove the \(filter.field.label) filter")
    }
    .font(.scaled(size: 12))
    .lineLimit(1)
    .frame(height: 24)
    .background(theme.bgTertiary)
    .clipShape(.rect(cornerRadius: 6))
    .fixedSize()
  }

  private var separator: some View {
    Rectangle().fill(theme.borderSubtle).frame(width: 1)
  }
}

extension IssueFilter {
  fileprivate func negating() -> IssueFilter {
    var filter = self
    filter.negate.toggle()
    return filter
  }
}

extension View {
  fileprivate func filterMenu(
    isPresented: Binding<Bool>, field: IssueFilter.Field?, issues: [HostStore.LinearIssue],
    filters: Binding<[IssueFilter]>
  ) -> some View {
    popover(isPresented: isPresented, arrowEdge: .bottom) {
      IssueFilterMenu(issues: issues, filters: filters, initialField: field) { isPresented.wrappedValue = false }
        .presentationCompactAdaptation(.popover)
    }
  }
}

/// Linear's "Add filter…": search, pick a field, then tick the values it
/// should match, each with how many issues it would keep.
struct IssueFilterMenu: View {
  @Environment(\.theme) private var theme
  let issues: [HostStore.LinearIssue]
  @Binding var filters: [IssueFilter]
  let onClose: () -> Void
  @State private var field: IssueFilter.Field?
  @State private var query = ""
  @FocusState private var searchFocused: Bool

  init(
    issues: [HostStore.LinearIssue], filters: Binding<[IssueFilter]>, initialField: IssueFilter.Field?,
    onClose: @escaping () -> Void
  ) {
    self.issues = issues
    _filters = filters
    self.onClose = onClose
    _field = State(initialValue: initialField)
    let text = initialField?.isText == true ? filters.wrappedValue.first { $0.field == initialField }?.values : nil
    _query = State(initialValue: text?.joined(separator: " ") ?? "")
  }

  private var needle: String { query.trimmingCharacters(in: .whitespaces).lowercased() }

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 6) {
        if field != nil {
          Button {
            open(nil)
          } label: {
            Image(systemName: Icon.chevronLeft).font(.scaled(size: 10, weight: .semibold))
          }
          .buttonStyle(.argusPlain)
          .foregroundStyle(theme.textSecondary)
          .accessibilityLabel("Back to fields")
        }
        TextField(placeholder, text: $query)
          .textFieldStyle(.plain)
          .font(.scaled(size: 13))
          .focused($searchFocused)
          .onSubmit(submitText)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      Divider()
      ScrollView {
        VStack(alignment: .leading, spacing: 0) { rows }
          .padding(4)
      }
      .frame(maxHeight: 340)
      .fixedSize(horizontal: false, vertical: true)
    }
    .frame(width: 260)
    .onAppear { searchFocused = true }
  }

  private var placeholder: String {
    guard let field else { return "Add filter…" }
    return field.isText ? "\(field.label) contains…" : "\(field.label)…"
  }

  @ViewBuilder private var rows: some View {
    if let field, field.isText {
      Text("Press Return to filter on this text.")
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textMuted)
        .padding(8)
    } else if let field {
      let picked = filters.first { $0.field == field }?.values ?? []
      ForEach(IssueFilters.options(field, issues: issues).filter(matchesQuery)) { option in
        Button {
          filters = IssueFilters.toggling(filters, field, option.value)
        } label: {
          HStack(spacing: 8) {
            OptionCheck(on: picked.contains(option.value))
            Text(option.label).lineLimit(1)
            Spacer(minLength: 8)
            Text("\(option.count)").foregroundStyle(theme.textMuted).monospacedDigit()
          }
        }
        .buttonStyle(MenuRowStyle())
        .accessibilityAddTraits(picked.contains(option.value) ? .isSelected : [])
      }
    } else {
      let groups = IssueFilters.groups.map { $0.filter { needle.isEmpty || $0.label.lowercased().contains(needle) } }
        .filter { !$0.isEmpty }
      ForEach(groups.indices, id: \.self) { index in
        if index > 0 { Divider().padding(.vertical, 4) }
        ForEach(groups[index]) { field in
          Button {
            open(field)
          } label: {
            HStack(spacing: 8) {
              Text(field.label)
              Spacer(minLength: 8)
              Image(systemName: Icon.chevronRight)
                .font(.scaled(size: 9, weight: .semibold))
                .foregroundStyle(theme.textMuted)
            }
          }
          .buttonStyle(MenuRowStyle())
        }
      }
    }
  }

  private func matchesQuery(_ option: IssueFilter.Option) -> Bool {
    needle.isEmpty || option.label.lowercased().contains(needle)
  }

  private func open(_ next: IssueFilter.Field?) {
    field = next
    query = ""
    searchFocused = true
  }

  private func submitText() {
    guard let field, field.isText else { return }
    let text = query.trimmingCharacters(in: .whitespaces)
    filters = IssueFilters.updating(filters, field) { filter in
      var filter = filter
      filter.values = text.isEmpty ? [] : [text]
      return filter
    }
    onClose()
  }
}

private struct OptionCheck: View {
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

/// A row in the filter menu: full width, a quiet fill under the pointer.
private struct MenuRowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    MenuRow(configuration: configuration).clickable()
  }

  private struct MenuRow: View {
    @Environment(\.theme) private var theme
    @State private var hovering = false
    let configuration: Configuration

    var body: some View {
      configuration.label
        .font(.scaled(size: 13))
        .foregroundStyle(theme.text)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
          hovering || configuration.isPressed ? theme.bgHover : Color.clear, in: .rect(cornerRadius: 5)
        )
        .contentShape(.rect)
        .onHover { hovering = $0 }
    }
  }
}

/// A part of a filter chip you can click.
private struct ChipSegmentStyle: ButtonStyle {
  let muted: Bool

  func makeBody(configuration: Configuration) -> some View {
    ChipSegment(configuration: configuration, muted: muted).clickable()
  }

  private struct ChipSegment: View {
    @Environment(\.theme) private var theme
    @State private var hovering = false
    let configuration: Configuration
    let muted: Bool

    var body: some View {
      configuration.label
        .foregroundStyle(muted ? theme.textSecondary : theme.text)
        .padding(.horizontal, 8)
        .frame(maxHeight: .infinity)
        .background(hovering || configuration.isPressed ? theme.bgHover : Color.clear)
        .contentShape(.rect)
        .onHover { hovering = $0 }
    }
  }
}

/// Filter and Clear: quiet text buttons that sit level with the chips.
private struct FilterBarButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    Segment(configuration: configuration).clickable()
  }

  private struct Segment: View {
    @Environment(\.theme) private var theme
    @State private var hovering = false
    let configuration: Configuration

    var body: some View {
      configuration.label
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textSecondary)
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(hovering || configuration.isPressed ? theme.bgHover : Color.clear, in: .rect(cornerRadius: 6))
        .contentShape(.rect)
        .onHover { hovering = $0 }
    }
  }
}
