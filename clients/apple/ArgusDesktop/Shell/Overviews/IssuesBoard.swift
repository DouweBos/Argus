import ArgusCore
import ArgusUI
import SwiftUI

/// A column per status, a swimlane per priority you can fold away; empty
/// lanes are left out — the desktop's Issues board.
struct IssuesBoard: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  let issues: [HostStore.LinearIssue]
  let selected: String?
  let onOpen: (HostStore.LinearIssue) -> Void
  @State private var collapsed: Set<Int> = []

  private static let columnWidth: CGFloat = 270

  var body: some View {
    let columns = LinearIssueBoard.columns(issues)
    ScrollView([.horizontal, .vertical]) {
      LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
        Section {
          ForEach(LinearIssueBoard.lanes(issues)) { lane in
            laneHead(lane)
            if !collapsed.contains(lane.priority) {
              HStack(alignment: .top, spacing: 12) {
                ForEach(columns) { column in
                  cell(LinearIssueBoard.cell(column, lane: lane))
                }
              }
              .padding(.bottom, 12)
            }
          }
        } header: {
          HStack(spacing: 12) {
            ForEach(columns) { columnHead($0) }
          }
          .padding(.vertical, 8)
          .background(theme.bg)
        }
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 16)
    }
  }

  private func columnHead(_ column: LinearIssueBoard.Column) -> some View {
    HStack(spacing: 6) {
      IssueStatusGlyph(type: column.type)
      Text(column.name).font(.scaled(size: 13, weight: .semibold)).foregroundStyle(theme.text)
      Text("\(column.issues.count)").font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
      Spacer(minLength: 0)
    }
    .frame(width: Self.columnWidth)
  }

  private func laneHead(_ lane: LinearIssueBoard.Lane) -> some View {
    let folded = collapsed.contains(lane.priority)
    return Button {
      if folded { collapsed.remove(lane.priority) } else { collapsed.insert(lane.priority) }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: folded ? Icon.chevronRight : Icon.chevronDown)
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(theme.textMuted)
          .frame(width: 10)
        PriorityGlyph(priority: lane.priority)
        Text(lane.title).font(.scaled(size: 12, weight: .semibold)).foregroundStyle(theme.textSecondary)
        Text("\(lane.count)").font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
      }
      .padding(.vertical, 6)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .help(folded ? "Show \(lane.title)" : "Hide \(lane.title)")
    .accessibilityLabel("\(lane.title), \(lane.count) issues, \(folded ? "collapsed" : "expanded")")
  }

  private func cell(_ issues: [HostStore.LinearIssue]) -> some View {
    VStack(spacing: 8) {
      ForEach(issues) { issue in
        Button {
          onOpen(issue)
        } label: {
          LinearIssueCard(
            issue: issue, agentOnIt: store.session(workingOn: issue) != nil,
            selected: issue.identifier == selected)
        }
        .buttonStyle(.argusPlain)
      }
    }
    .frame(width: Self.columnWidth, alignment: .top)
  }
}
