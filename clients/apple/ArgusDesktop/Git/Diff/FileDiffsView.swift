import ArgusUI
import GroveKit
import GroveUIKit
import SwiftUI

/// `+12 −3`, coloured; nothing for `+0 −0`.
struct DiffStatsLabel: View {
  let stats: DiffStats

  var body: some View {
    ChangeCounts(additions: stats.additions, deletions: stats.deletions)
  }
}

/// A file's status as the one-letter badge git uses.
struct FileStatusBadge: View {
  @Environment(\.theme) private var theme
  let status: FileStatus

  var body: some View {
    Text(letter)
      .font(.scaled(size: 10, weight: .bold, design: .monospaced))
      .foregroundStyle(tone.color(theme))
      .frame(width: 16, height: 16)
      .background(tone.soft(theme), in: .rect(cornerRadius: 4))
      .help(label)
  }

  private var letter: String {
    switch status {
    case .untracked: "U"
    case .conflicted: "!"
    case .unmodified: " "
    default: status.rawValue
    }
  }

  private var tone: Tone {
    switch status {
    case .added, .untracked, .copied: .success
    case .deleted: .danger
    case .conflicted: .warning
    case .renamed, .typeChange: .accent
    default: .muted
    }
  }

  private var label: String {
    switch status {
    case .modified: "Modified"
    case .added: "Added"
    case .deleted: "Deleted"
    case .renamed: "Renamed"
    case .copied: "Copied"
    case .untracked: "Untracked"
    case .ignored: "Ignored"
    case .conflicted: "Conflicted"
    case .typeChange: "Type changed"
    case .unmodified: "Unmodified"
    }
  }
}

/// A commit's, stash's or comparison's files beside the selected file's diff.
struct FileDiffsView: View {
  let files: [FileDiff]
  var isLoading = false
  /// Context-menu extras per file (history, blame, restore, …).
  var fileMenu: ((FileDiff) -> AnyView)?
  /// Review comments on the shown file, by its path; nil where the diffs can't take them.
  var review: ((String) -> DiffReviewContext)?
  /// Viewed marks; nil where the diff doesn't keep them.
  var viewed: ViewedFiles?
  /// The revisions the files compare; nil where the repository doesn't have them.
  var images: GitDiffImages?
  @State private var selected: String?

  var body: some View {
    ResizableHSplit(key: "git.files", leadingMin: 180, leadingIdeal: 260, leadingMax: 420, trailingMin: 280) {
      VStack(spacing: 0) {
        if let viewed, !files.isEmpty {
          ViewedProgress(viewed: viewed.viewedCount(files.map(\.path)), total: files.count)
          Divider()
        }
        FileDiffList(files: files, selected: $selected, isLoading: isLoading, fileMenu: fileMenu, viewed: viewed)
      }
    } trailing: {
      DiffPane(
        diff: current?.diff, path: current?.path, isLoading: isLoading, review: current.flatMap { review?($0.path) },
        images: images, accessory: viewedAccessory)
    }
  }

  private var viewedAccessory: AnyView? {
    guard let viewed, let path = current?.path else { return nil }
    return AnyView(ViewedCheckbox(viewed: viewed, path: path) { advance(from: path) })
  }

  /// The next file after `path` still to review, wrapping round.
  private func advance(from path: String) {
    guard let viewed, let index = files.firstIndex(where: { $0.path == path }) else { return }
    let rest = files[(index + 1)...] + files[..<index]
    if let next = rest.first(where: { !viewed.isViewed($0.path) }) { selected = next.path }
  }

  private var current: FileDiff? {
    files.first { $0.path == selected }
  }
}

/// Changed files with their counts and status; keeps a selection, the first file by default.
struct FileDiffList: View {
  let files: [FileDiff]
  @Binding var selected: String?
  var isLoading = false
  var fileMenu: ((FileDiff) -> AnyView)?
  var viewed: ViewedFiles?
  @FocusState private var listFocused: Bool

  var body: some View {
    List(files, id: \.path) { file in
      HStack(spacing: 6) {
        FileTypeIcon(path: file.path)
        Text((file.path as NSString).lastPathComponent).lineLimit(1)
        Text((file.path as NSString).deletingLastPathComponent)
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.head)
        Spacer(minLength: 4)
        if let viewed { ViewedMark(state: viewed.state(file.path)) }
        DiffStatsLabel(stats: file.stats)
        FileStatusBadge(status: file.status)
      }
      .font(.scaled(size: 12))
      .opacity(viewed?.isViewed(file.path) == true ? 0.6 : 1)
      .contentShape(.rect)
      .onTapGesture {
        selected = file.path
        listFocused = true
      }
      .clickable()
      .modifier(NavigatorRowHighlight(selected: selected == file.path))
      .contextMenu { fileMenu?(file) }
    }
    .navigatorList()
    .focused($listFocused)
    .onKeyPress(keys: [.upArrow, .downArrow]) { press in
      move(by: press.key == .upArrow ? -1 : 1)
      return .handled
    }
    .overlay {
      if isLoading && files.isEmpty { ProgressView().controlSize(.small) }
    }
    .onChange(of: files.map(\.path), initial: true) { _, paths in
      if selected == nil || !paths.contains(selected ?? "") { selected = paths.first }
    }
  }

  private func move(by offset: Int) {
    guard let index = files.firstIndex(where: { $0.path == selected }) else { return selected = files.first?.path }
    selected = files[min(max(index + offset, 0), files.count - 1)].path
  }
}
