import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// One changed file: status badge, name, directory and its stage button.
struct ChangeRow: View {
  @Environment(\.theme) private var theme
  let entry: StatusEntry
  let section: ChangeSection
  let showsDirectory: Bool
  var isLFS = false
  let toggleStage: () -> Void

  private var status: FileStatus {
    switch section {
    case .conflicted: .conflicted
    case .staged: entry.indexStatus
    case .unstaged: entry.workdirStatus
    }
  }

  var body: some View {
    HStack(spacing: 6) {
      FileStatusBadge(status: status)
      Text(entry.fileName)
        .lineLimit(1)
      if showsDirectory, !entry.directory.isEmpty {
        Text(entry.directory)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.head)
      }
      Spacer(minLength: 4)
      if isLFS {
        Text("LFS")
          .font(.scaled(size: 9, weight: .semibold))
          .foregroundStyle(.secondary)
          .padding(.horizontal, 4)
          .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(.secondary.opacity(0.5)))
          .help("Stored with Git LFS")
      }
      if section != .conflicted {
        Button(action: toggleStage) {
          Image(systemName: section == .staged ? "minus.circle" : "plus.circle")
        }
        .buttonStyle(.borderless)
        .help(section == .staged ? "Unstage" : "Stage")
        .accessibilityLabel("\(section == .staged ? "Unstage" : "Stage") \(entry.path)")
      }
    }
    .font(.scaled(size: 12))
    .help(entry.path)
    .contentShape(.rect)
  }
}

/// The context menu of a Changes row; inside a multi-selection it acts on all of it.
struct ChangeRowMenu: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let entry: StatusEntry
  let section: ChangeSection
  var onShowFileHistory: ((String) -> Void)?

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var actions: WorkingCopyActions { WorkingCopyActions(workspace: workspace) }

  var body: some View {
    let entries = vm.actionEntries(for: entry, side: section.side)
    if section == .conflicted {
      Button("Resolve…") { model.navigate(.sessionGit(id: workspace.sessionId, view: .conflicts)) }
    } else {
      let row = FileRow(path: entry.path, side: section.side)
      let rows: Set<FileRow> =
        vm.fileSelection.contains(row) ? vm.fileSelection.rows.filter { $0.side == section.side } : [row]
      let verb = section == .staged ? "Unstage" : "Stage"
      Button(rows.count > 1 ? "\(verb) \(rows.count) Files" : verb) { Task { await actions.toggle(rows) } }
      Button(entries.count > 1 ? "Discard Changes in \(entries.count) Files…" : "Discard Changes…", role: .destructive) {
        vm.requestDiscard(entries)
      }
    }
    if entries.count == 1, entry.workdirStatus != .deleted, entry.indexStatus != .deleted {
      Button("Open File") { model.openCode(session: workspace.sessionId, path: entry.path, source: .changes) }
    }
    Divider()
    ChangeFileActionsMenu(workspace: workspace, entries: entries)
    ChangeLFSAndPatchMenu(workspace: workspace, entry: entry, section: section, entries: entries)
    Divider()
    Button(entries.count > 1 ? "Copy \(entries.count) Paths" : "Copy Path") {
      Clipboard.copy(entries.map(\.path).joined(separator: "\n"))
    }
    if !workspace.isRemote {
      Button("Reveal in Finder") {
        NSWorkspace.shared.activateFileViewerSelecting(
          entries.map { workspace.repository.path.appendingPathComponent($0.path) })
      }
    }
    if entries.count == 1, entry.workdirStatus != .untracked, entry.indexStatus != .added {
      Divider()
      if let onShowFileHistory {
        Button("File History") { onShowFileHistory(entry.path) }
      }
      Button("Blame") { model.navigate(.sessionGit(id: workspace.sessionId, view: .blame(path: entry.path, ref: nil))) }
    }
  }
}

/// Ignore, Stop Tracking, Rename and Move to Trash.
private struct ChangeFileActionsMenu: View {
  let workspace: GitWorkspace
  let entries: [StatusEntry]

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var actions: WorkingCopyActions { WorkingCopyActions(workspace: workspace) }
  private var untracked: [StatusEntry] { entries.filter { $0.workdirStatus == .untracked } }

  var body: some View {
    if !untracked.isEmpty {
      Menu(untracked.count > 1 ? "Ignore \(untracked.count) Files" : "Ignore") {
        ignoreItems(localOnly: false)
        Divider()
        Menu("Local Only (.git/info/exclude)") { ignoreItems(localOnly: true) }
      }
    }
    let tracked = vm.trackedEntries(entries)
    if !tracked.isEmpty {
      Button(tracked.count > 1 ? "Stop Tracking \(tracked.count) Files" : "Stop Tracking") {
        Task { await actions.stopTracking(tracked) }
      }
    }
    let existing = vm.existingEntries(entries)
    if entries.count == 1, let first = existing.first {
      Button("Rename…") { vm.requestRename(first) }
    }
    if !existing.isEmpty {
      Button(existing.count > 1 ? "Move \(existing.count) Files to Trash…" : "Move to Trash…") {
        vm.requestDelete(existing)
      }
    }
  }

  @ViewBuilder
  private func ignoreItems(localOnly: Bool) -> some View {
    ForEach(vm.ignoreTargets(for: untracked), id: \.self) { target in
      Button(title(for: target)) { Task { await actions.ignore(target, of: untracked, localOnly: localOnly) } }
    }
  }

  private func title(for target: IgnoreTarget) -> String {
    switch target {
    case .files: untracked.count == 1 ? "Ignore “\(untracked[0].fileName)”" : "Ignore These Files"
    case .fileExtension(let ext): "Ignore All “*.\(ext)” Files"
    case .folder(let folder): "Ignore Folder “\(folder)”"
    }
  }
}
