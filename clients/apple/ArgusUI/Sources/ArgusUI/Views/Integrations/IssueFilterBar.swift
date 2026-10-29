import ArgusCore
import SwiftUI

/// Linear's filter row: Filter, a chip per active filter, Clear — the
/// desktop's `IssueFilterBar`.
public struct IssueFilterBar: View {
  /// The unfiltered issues, so each option shows how many it would match.
  let issues: [HostStore.LinearIssue]
  /// The teams' workflow, so Status lists every state in order, unused ones too.
  let states: [ArgusProtocol.LinearWorkflowState]
  @Binding var filters: [IssueFilter]
  @State private var adding = false

  public init(
    issues: [HostStore.LinearIssue], states: [ArgusProtocol.LinearWorkflowState] = [],
    filters: Binding<[IssueFilter]>
  ) {
    self.issues = issues
    self.states = states
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
        .issueFilterMenu(isPresented: $adding, field: nil, issues: issues, states: states, filters: $filters)
        ForEach(filters, id: \.field) { filter in
          IssueFilterChip(filter: filter, issues: issues, states: states, filters: $filters)
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
  let states: [ArgusProtocol.LinearWorkflowState]
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
        .issueFilterMenu(isPresented: $editing, field: filter.field, issues: issues, states: states, filters: $filters)
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
