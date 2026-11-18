import ArgusCore
import ArgusKit
import SwiftUI

/// One agent turn on a session's timeline: its number, the prompt's first line,
/// then the agent, when, and what it changed.
public struct TimelineTurnRow: View {
  @Environment(\.theme) private var theme
  let turn: TimelineTurn
  /// Rows lay out the same on both apps; the phone's are a touch roomier.
  var compact: Bool

  public init(turn: TimelineTurn, compact: Bool = true) {
    self.turn = turn
    self.compact = compact
  }

  public var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Text(turn.number, format: .number)
        .font(.scaled(size: 11, design: .monospaced))
        .foregroundStyle(theme.textMuted)
        .frame(minWidth: 20, alignment: .trailing)
      VStack(alignment: .leading, spacing: compact ? 3 : 4) {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text(turn.prompt.isEmpty ? "No text" : turn.prompt)
            .font(.scaled(size: compact ? 13 : 15))
            .foregroundStyle(turn.available ? theme.text : theme.textMuted)
            .lineLimit(compact ? 1 : 2)
          Spacer(minLength: 6)
          Text(Labels.timeAgo(turn.timestamp))
            .font(.scaled(size: 11))
            .foregroundStyle(theme.textMuted)
            .fixedSize()
        }
        meta
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var meta: some View {
    HStack(spacing: 6) {
      if let title = turn.agentTitle {
        Label(title, systemImage: Icon.agent)
          .labelStyle(TightLabelStyle())
          .lineLimit(1)
      }
      if !turn.available {
        Badge(label: "Checkpoint gone")
      } else if !turn.finished {
        Badge(label: "Running", tone: .accent)
      } else if turn.files == 0 {
        Text("No file changes")
      } else {
        Text(turn.files == 1 ? "1 file" : "\(turn.files) files")
          .fixedSize()
        ChangeCounts(additions: turn.additions, deletions: turn.deletions)
      }
    }
    .font(.scaled(size: 11))
    .foregroundStyle(theme.textSecondary)
  }
}

/// The files put back to where a turn ended, between the turns on the timeline.
public struct TimelineRestoreRow: View {
  @Environment(\.theme) private var theme
  let restore: TimelineRestore
  let undo: (() -> Void)?

  public init(restore: TimelineRestore, undo: (() -> Void)? = nil) {
    self.restore = restore
    self.undo = undo
  }

  public var body: some View {
    HStack(alignment: .center, spacing: 10) {
      Image(systemName: Icon.restoreVersion)
        .font(.scaled(size: 11, weight: .semibold))
        .foregroundStyle(restore.undoneAt == nil ? theme.accent : theme.textMuted)
        .frame(minWidth: 20, alignment: .trailing)
      VStack(alignment: .leading, spacing: 3) {
        Text("Restored to the end of turn \(restore.turnNumber)")
          .font(.scaled(size: 12, weight: .medium))
          .foregroundStyle(restore.undoneAt == nil ? theme.text : theme.textMuted)
          .strikethrough(restore.undoneAt != nil, color: theme.textMuted)
        Text(detail)
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textMuted)
      }
      Spacer(minLength: 6)
      if let undo {
        Button(action: undo) {
          Label("Undo Restore", systemImage: Icon.undo)
        }
        .buttonStyle(.argusBorderless)
        .font(.scaled(size: 12))
        .help("Put the files back to how they were before this restore")
      }
    }
  }

  private var detail: String {
    let restored = Labels.timeAgo(restore.timestamp)
    guard let undone = restore.undoneAt else { return "Files only, the conversation stays · \(restored)" }
    return "Undone \(Labels.timeAgo(undone)) · \(restored)"
  }
}

/// Icon and title close together, for a row's quiet metadata.
private struct TightLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 3) {
      configuration.icon.font(.scaled(size: 9))
      configuration.title
    }
  }
}
