import ArgusUI
import GroveKit
import SwiftUI

/// The code view's left column: the session's changed files (the default),
/// the worktree's tree, or worktree search.
struct CodeNavigator: View {
  @Environment(\.theme) private var theme
  @Bindable var code: CodeSession
  let activePath: String?

  var body: some View {
    VStack(spacing: 0) {
      Picker("Navigator", selection: $code.navigatorMode) {
        ForEach(CodeNavigatorMode.allCases, id: \.self) { Text($0.title).tag($0) }
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .controlSize(.small)
      .padding(8)
      Divider()
      switch code.navigatorMode {
      case .changes: CodeChangesList(code: code, activePath: activePath)
      case .files: CodeFilesTree(code: code, activePath: activePath)
      case .search: CodeSearchView(search: code.search, code: code)
      }
    }
    .background(theme.bgSecondary)
  }
}

/// What the session changed, as the git panel's working copy has it.
private struct CodeChangesList: View {
  @Environment(DesktopModel.self) private var model
  let code: CodeSession
  let activePath: String?

  var body: some View {
    let entries = code.changedEntries
    List(entries) { entry in
      CodeFileRow(
        path: entry.path, selected: entry.path == activePath, status: Self.status(entry),
        open: { code.navigate(to: entry.path, source: .changes) }, pin: { code.pin(entry.path) }
      )
      .contextMenu {
        Button("Open File") { code.navigate(to: entry.path, source: .changes) }
        Button("Show Diff in Git") {
          if let workingCopy = model.git.workspace(code.sessionId)?.workingCopy {
            Task { await workingCopy.select(entry) }
          }
          model.navigate(.sessionGit(id: code.sessionId, view: .working))
        }
        Divider()
        Button("Copy Path") { Clipboard.copy(entry.path) }
      }
    }
    .listStyle(.sidebar)
    .overlay {
      if entries.isEmpty {
        EmptyState(icon: "checkmark.circle", title: "No changes", body: "Files the session changes show here.")
      }
    }
  }

  static func status(_ entry: StatusEntry) -> FileStatus {
    entry.isConflicted ? .conflicted : entry.workdirStatus != .unmodified ? entry.workdirStatus : entry.indexStatus
  }
}

/// Every file git sees in the worktree (tracked, plus untracked that aren't ignored).
private struct CodeFilesTree: View {
  let code: CodeSession
  let activePath: String?

  var body: some View {
    List {
      CodeTreeRows(nodes: code.fileTree, code: code, activePath: activePath)
    }
    .listStyle(.sidebar)
    .overlay {
      if code.fileTree.isEmpty {
        if code.fileListLoading {
          ProgressView().controlSize(.small)
        } else {
          EmptyState(icon: "doc", title: "No files")
        }
      }
    }
    .task { await code.loadFileList() }
  }
}

/// One level of the Files tree; folders remember whether they're open so their icon can follow.
private struct CodeTreeRows: View {
  let nodes: [CodeTreeNode]
  @Bindable var code: CodeSession
  let activePath: String?

  var body: some View {
    ForEach(nodes) { node in
      if let children = node.children {
        DisclosureGroup(isExpanded: expanded(node.path)) {
          CodeTreeRows(nodes: children, code: code, activePath: activePath)
        } label: {
          HStack(spacing: 6) {
            FileTypeIcon(path: node.path, isDirectory: true, isExpanded: code.expandedFolders.contains(node.path))
            Text(node.name).lineLimit(1)
          }
          .font(.scaled(size: 12))
        }
      } else {
        CodeFileRow(
          path: node.path, selected: node.path == activePath, showsDirectory: false,
          open: { code.navigate(to: node.path, source: .tree) }, pin: { code.pin(node.path) })
      }
    }
  }

  private func expanded(_ path: String) -> Binding<Bool> {
    Binding(
      get: { code.expandedFolders.contains(path) },
      set: { open in
        if open { code.expandedFolders.insert(path) } else { code.expandedFolders.remove(path) }
      })
  }
}

/// A file in a navigator list: single click previews it, double click keeps the tab.
struct CodeFileRow: View {
  @Environment(\.theme) private var theme
  let path: String
  let selected: Bool
  var status: FileStatus?
  var showsDirectory = true
  let open: () -> Void
  let pin: () -> Void

  var body: some View {
    HStack(spacing: 6) {
      FileTypeIcon(path: path)
      Text((path as NSString).lastPathComponent).lineLimit(1)
      if showsDirectory {
        Text((path as NSString).deletingLastPathComponent)
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
          .truncationMode(.head)
      }
      Spacer(minLength: 0)
      if let status { FileStatusBadge(status: status) }
    }
    .font(.scaled(size: 12))
    .contentShape(Rectangle())
    .gesture(TapGesture(count: 2).onEnded(pin))
    .simultaneousGesture(TapGesture().onEnded(open))
    .listRowBackground(selected ? theme.accentSoft : Color.clear)
    .help(path)
  }
}
