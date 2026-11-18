import ArgusCore
import SwiftUI

/// A section's quiet header: its title, a rule, and an optional trailing control.
/// The Mac sidebar's Needs you and Scratch pads, and the phone's project cards.
public struct SidebarSectionHeader<Trailing: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  @ViewBuilder var trailing: Trailing

  public init(title: String, @ViewBuilder trailing: () -> Trailing) {
    self.title = title
    self.trailing = trailing()
  }

  public var body: some View {
    HStack {
      Text(title)
        .font(Self.font)
        .foregroundStyle(theme.textMuted)
      Rectangle().fill(theme.border).frame(height: 1)
      trailing
    }
    .padding(.leading, Self.leading)
    .frame(minHeight: 20)
  }

  #if os(macOS)
    private static var font: Font { .scaled(size: 11, weight: .medium) }
    private static var leading: CGFloat { 8 }
  #else
    private static var font: Font { .scaled(.footnote).weight(.medium) }
    private static var leading: CGFloat { 0 }
  #endif
}

extension SidebarSectionHeader where Trailing == EmptyView {
  public init(title: String) {
    self.init(title: title) { EmptyView() }
  }
}

/// "2 done · 1 snoozed" behind a chevron: the row that unfolds a project's done and snoozed sessions.
public struct FoldedSessionsLabel: View {
  @Environment(\.theme) private var theme
  let label: String
  let expanded: Bool

  public init(_ label: String, expanded: Bool) {
    self.label = label
    self.expanded = expanded
  }

  public var body: some View {
    HStack(spacing: 6) {
      Image(systemName: expanded ? Icon.chevronDown : Icon.chevronRight)
        .font(Self.chevronFont)
        .frame(width: 8)
      Text(label).font(Self.font)
      Spacer(minLength: 0)
    }
    .foregroundStyle(theme.textMuted)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityValue(expanded ? "Expanded" : "Collapsed")
  }

  #if os(macOS)
    private static var font: Font { .scaled(size: 11) }
    private static var chevronFont: Font { .scaled(size: 9, weight: .semibold) }
  #else
    private static var font: Font { .scaled(.footnote) }
    private static var chevronFont: Font { .scaled(.caption2).weight(.semibold) }
  #endif
}

/// A project's root checkout in its header: the branch, with a dot while its agents work.
public struct ProjectRootState: View {
  @Environment(\.theme) private var theme
  let activity: SessionActivity
  let branch: String

  public init(activity: SessionActivity, branch: String) {
    self.activity = activity
    self.branch = branch
  }

  public var body: some View {
    HStack(spacing: 4) {
      if activity.showsDot { StatusDot(tone: activity.tone, pulse: activity.isBusy) }
      Text(branch)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    // Framed as a pair so a short branch keeps the dot beside it.
    .frame(maxWidth: 100, alignment: .trailing)
    .foregroundStyle(activity.session.status == .error ? theme.error : theme.textMuted)
  }
}

/// Where a session row sits among its siblings.
public struct SessionRowPlacement: Sendable {
  /// A compare run's slot, under its run's header.
  public var slot = false
  public var indent = 0
  public var stacked = false
  /// The stack parent it's on, when that parent is listed elsewhere.
  public var caption: String?
}

/// Session groups as rows, a compare run's slots under its header and a stacked
/// session under its parent; apart from its parent, its caption names it. The
/// phone's Home, project screen and iPad sidebar all list sessions this way.
public struct SessionGroupRows<Row: View, Header: View>: View {
  let groups: [SessionGroup]
  let all: [RemoteSession]
  let row: (SessionGroup, SessionRowPlacement) -> Row
  let header: (CompareGroup) -> Header

  public init(
    _ groups: [SessionGroup], all: [RemoteSession],
    @ViewBuilder row: @escaping (SessionGroup, SessionRowPlacement) -> Row,
    @ViewBuilder header: @escaping (CompareGroup) -> Header
  ) {
    self.groups = groups
    self.all = all
    self.row = row
    self.header = header
  }

  public var body: some View {
    let arranged = SessionStack.arrange(groups, session: \.session, all: all)
    ForEach(CompareSessionRow.make(arranged.items)) { item in
      switch item {
      case .session(let group):
        let nesting = arranged.nesting[group.id] ?? .none
        row(group, SessionRowPlacement(indent: nesting.depth, stacked: nesting.depth > 0, caption: nesting.caption))
      case .compare(let run, let slots):
        header(run)
        ForEach(slots) { row($0, SessionRowPlacement(slot: true, indent: 1)) }
      }
    }
  }
}
