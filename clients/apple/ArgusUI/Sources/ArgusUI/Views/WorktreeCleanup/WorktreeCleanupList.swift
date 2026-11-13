import ArgusCore
import ArgusKit
import SwiftUI

/// The dry run: one row per worktree with its reclaimable size, then the ones
/// a guard keeps, then Clean Up Now and how the last sweep went.
struct WorktreeCleanupList: View {
  @Environment(\.theme) private var theme
  let model: WorktreeCleanupModel
  let canRun: Bool

  var body: some View {
    SettingsGroup(removeTitle, footer: lastSweepLine) {
      if model.removable.isEmpty {
        SettingsRow("Nothing to clean up", description: "No worktree matches the rules above right now.")
      } else {
        ForEach(model.removable, id: \.sessionId) { WorktreeCleanupRow(entry: $0) }
      }
      SettingsRow(summary, description: totalLine) {
        Btn(
          label: "Clean Up Now", tone: .danger, small: true, icon: Icon.trash, busy: model.cleaning
        ) {
          Task { await model.cleanUpNow() }
        }
        .disabled(!canRun || model.removable.isEmpty || model.cleaning)
      }
    }
    if !model.kept.isEmpty {
      SettingsGroup("Kept", footer: "These match the rules but hold work that isn't saved anywhere else.") {
        ForEach(model.kept, id: \.sessionId) { WorktreeCleanupRow(entry: $0) }
      }
    }
  }

  private var removeTitle: String {
    model.removable.isEmpty ? "Would be removed" : "Would be removed (\(model.removable.count))"
  }

  private var summary: String {
    let n = model.removable.count
    return n == 0
      ? "Nothing to reclaim"
      : "\(n) worktree\(n == 1 ? "" : "s"), \(WorktreeCleanupFormat.bytes(model.reclaimableBytes))"
  }

  private var totalLine: String? {
    guard let total = model.preview?.totalBytes, total > 0 else { return nil }
    return "Worktrees take \(WorktreeCleanupFormat.bytes(total)) in all."
  }

  private var lastSweepLine: String? {
    guard let sweep = model.preview?.lastSweep else { return nil }
    let when = WorktreeCleanupFormat.relative(ms: sweep.at)
    let n = sweep.removed.count
    let what =
      n == 0
      ? "removed nothing"
      : "removed \(n) worktree\(n == 1 ? "" : "s") and freed \(WorktreeCleanupFormat.bytes(sweep.freedBytes))"
    let kind = sweep.trigger == .scheduled ? "Last automatic cleanup" : "Last cleanup"
    return "\(kind) \(when) \(what)."
  }
}

struct WorktreeCleanupRow: View {
  @Environment(\.theme) private var theme
  let entry: WorktreeCleanupModel.Entry

  var body: some View {
    HStack(spacing: 10) {
      SettingsRowIcon(entry.blockedBy == nil ? Icon.branch : "lock")
      VStack(alignment: .leading, spacing: 2) {
        Text(entry.displayName ?? entry.branch)
          .font(.scaled(size: 13, weight: .medium))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text("\(entry.projectName) · \(WorktreeCleanupFormat.why(entry))")
          .font(.scaled(size: 11.5))
          .foregroundStyle(entry.blockedBy == nil ? theme.textSecondary : theme.warning)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      Text(entry.bytes.map(WorktreeCleanupFormat.bytes) ?? "—")
        .font(.scaled(size: 12).monospacedDigit())
        .foregroundStyle(theme.textSecondary)
    }
    .accessibilityElement(children: .combine)
  }
}

enum WorktreeCleanupFormat {
  static func bytes(_ value: Double) -> String {
    ByteCountFormatter.string(fromByteCount: Int64(value), countStyle: .file)
  }

  static func relative(ms: Double) -> String {
    let date = Date(timeIntervalSince1970: ms / 1000)
    return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: .now)
  }

  static func why(_ entry: WorktreeCleanupModel.Entry) -> String {
    if let guarded = entry.blockedBy {
      switch guarded {
      case .agentRunning: return "an agent is running"
      case .uncommitted: return "uncommitted changes"
      case .unpushed: return "commits not pushed or merged"
      default: return "couldn't read its git state"
      }
    }
    switch entry.reason {
    case .landed: return "merged \(relative(ms: entry.landedAt ?? entry.lastActivityAt))"
    case .overCap: return "over the disk limit, last used \(relative(ms: entry.lastActivityAt))"
    default: return "untouched since \(relative(ms: entry.lastActivityAt))"
    }
  }
}
