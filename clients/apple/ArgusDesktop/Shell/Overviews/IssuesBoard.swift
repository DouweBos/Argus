import ArgusCore
import ArgusUI
import SwiftUI

/// A column per status, a swimlane per priority you can fold away; empty
/// lanes are left out — the desktop's Issues board. Every state of the teams'
/// workflows is a column, shown or listed under Hidden columns.
struct IssuesBoard: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  let issues: [HostStore.LinearIssue]
  /// The teams' workflows, so states no issue is in still get a column.
  let states: [HostStore.LinearWorkflowState]
  let selected: String?
  let onOpen: (HostStore.LinearIssue) -> Void
  @State private var collapsed: Set<Int> = []
  /// Column id → hidden, against the defaults; JSON so it survives relaunch.
  @AppStorage("issues.columns") private var overridesJSON = "{}"

  private static let columnWidth: CGFloat = 270

  private var overrides: [String: Bool] {
    (try? JSONDecoder().decode([String: Bool].self, from: Data(overridesJSON.utf8))) ?? [:]
  }

  private func setHidden(_ id: String, _ hidden: Bool) {
    var next = overrides
    next[id] = hidden
    if let data = try? JSONEncoder().encode(next) { overridesJSON = String(decoding: data, as: UTF8.self) }
  }

  var body: some View {
    let all = LinearIssueBoard.columns(issues, states: states)
    let columns = all.filter { !LinearIssueBoard.isHidden($0, overrides: overrides) }
    let hidden = all.filter { LinearIssueBoard.isHidden($0, overrides: overrides) }
    HStack(alignment: .top, spacing: 0) {
      board(columns)
      if !hidden.isEmpty { hiddenPanel(hidden) }
    }
  }

  private static let columnSpacing: CGFloat = 12

  /// The width every lane spans: all columns and the gaps between them.
  private func boardWidth(_ count: Int) -> CGFloat {
    CGFloat(count) * Self.columnWidth + CGFloat(max(count - 1, 0)) * Self.columnSpacing
  }

  private func board(_ columns: [LinearIssueBoard.Column]) -> some View {
    // A two-axis scroll view centres content smaller than itself; filling at
    // least the viewport and aligning top-leading keeps the board in the corner.
    GeometryReader { viewport in
      ScrollView([.horizontal, .vertical]) {
        boardContent(columns)
          .frame(
            minWidth: viewport.size.width, minHeight: viewport.size.height, alignment: .topLeading)
      }
    }
  }

  private func boardContent(_ columns: [LinearIssueBoard.Column]) -> some View {
    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: .sectionHeaders) {
        Section {
          // Lanes count only what's on the board, so a lane of hidden issues disappears.
          ForEach(LinearIssueBoard.lanes(columns.flatMap(\.issues))) { lane in
            laneHead(lane, width: boardWidth(columns.count))
            if !collapsed.contains(lane.priority) {
              HStack(alignment: .top, spacing: Self.columnSpacing) {
                ForEach(columns) { column in
                  cell(LinearIssueBoard.cell(column, lane: lane))
                }
              }
              .padding(.top, 6)
              .padding(.bottom, 16)
            }
          }
        } header: {
          HStack(spacing: Self.columnSpacing) {
            ForEach(columns) { columnHead($0) }
          }
          .padding(.vertical, 8)
          .background(theme.bg)
        }
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 16)
  }

  private func columnHead(_ column: LinearIssueBoard.Column) -> some View {
    HStack(spacing: 6) {
      IssueStatusGlyph(type: column.type, color: column.color)
      Text(column.name).font(.scaled(size: 13, weight: .semibold)).foregroundStyle(theme.text)
      Text("\(column.issues.count)").font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
      Spacer(minLength: 0)
      Button {
        setHidden(column.id, true)
      } label: {
        Image(systemName: "minus").font(.system(size: 10, weight: .semibold)).foregroundStyle(theme.textMuted)
          .frame(width: 18, height: 18).contentShape(Rectangle())
      }
      .buttonStyle(.argusPlain)
      .help("Hide \(column.name)")
      .accessibilityLabel("Hide \(column.name)")
    }
    .frame(width: Self.columnWidth)
  }

  /// Every hidden state, empty ones too, like Linear's "Hidden columns".
  private func hiddenPanel(_ columns: [LinearIssueBoard.Column]) -> some View {
    ScrollView(.vertical) { hiddenList(columns) }
      .scrollBounceBehavior(.basedOnSize)
      .frame(width: 220)
      .padding(.trailing, 16)
  }

  private func hiddenList(_ columns: [LinearIssueBoard.Column]) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Hidden columns").font(.scaled(size: 12)).foregroundStyle(theme.textMuted).padding(.vertical, 8)
      ForEach(columns) { column in
        Button {
          setHidden(column.id, false)
        } label: {
          HStack(spacing: 8) {
            IssueStatusGlyph(type: column.type, color: column.color)
            Text(column.name).font(.scaled(size: 13)).foregroundStyle(theme.text)
            Spacer(minLength: 0)
            Text("\(column.issues.count)").font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
          }
          .padding(.horizontal, 10)
          .padding(.vertical, 8)
          .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
          .contentShape(Rectangle())
        }
        .buttonStyle(.argusPlain)
        .help("Show \(column.name)")
      }
    }
    .padding(.bottom, 16)
  }

  /// A full-width bar per priority, so the lanes read as rows across every column.
  private func laneHead(_ lane: LinearIssueBoard.Lane, width: CGFloat) -> some View {
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
        Text(lane.title).font(.scaled(size: 13, weight: .semibold)).foregroundStyle(theme.text)
        Text("\(lane.count)").font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .frame(width: width, alignment: .leading)
      .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: 8))
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
    // Inset so the padded cell is exactly a column wide, under its header.
    .frame(width: Self.columnWidth - 12, alignment: .top)
    .frame(minHeight: 44, alignment: .top)
    .padding(6)
    .background(theme.bgSecondary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
  }
}
