import ArgusUI
import GroveKit
import SwiftUI

/// The code view's left column: the session's changed files (the default),
/// the worktree's tree, or worktree search. No background of its own, so it
/// sits on the canvas of whichever pane holds it and stays below the toolbar.
struct CodeNavigator: View {
  @Environment(\.theme) private var theme
  @Bindable var code: CodeSession
  let activePath: String?

  var body: some View {
    VStack(spacing: 0) {
      modeTabs
      Rectangle().fill(theme.border).frame(height: 1)
      switch code.navigatorMode {
      case .changes: CodeChangesList(code: code, activePath: activePath)
      case .files: CodeFilesTree(code: code, activePath: activePath)
      case .search: CodeSearchView(code: code)
      }
    }
  }

  /// Quiet text tabs; icons alone when the column is too narrow for the titles.
  private var modeTabs: some View {
    ViewThatFits(in: .horizontal) {
      tabs(titled: true)
      tabs(titled: false)
    }
    .padding(.horizontal, 8)
    .frame(height: 34)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func tabs(titled: Bool) -> some View {
    HStack(spacing: 2) {
      ForEach(CodeNavigatorMode.allCases, id: \.self) { mode in
        Button {
          code.navigatorMode = mode
        } label: {
          if titled {
            Text(mode.title)
          } else {
            Image(systemName: mode.symbol).accessibilityLabel(mode.title)
          }
        }
        .buttonStyle(QuietTabButtonStyle(selected: code.navigatorMode == mode))
        .help(mode.title)
        .accessibilityAddTraits(code.navigatorMode == mode ? .isSelected : [])
      }
    }
    .fixedSize()
  }
}

extension CodeNavigatorMode {
  fileprivate var symbol: String {
    switch self {
    case .files: Icon.folder
    case .search: Icon.search
    case .changes: "plusminus"
    }
  }
}

/// The navigator's lists: compact rows straight on the canvas, no source-list material.
extension View {
  func navigatorList() -> some View {
    listStyle(.inset)
      .scrollContentBackground(.hidden)
      .environment(\.defaultMinListRowHeight, 22)
  }
}

/// A navigator row's highlight: the sidebar's quiet fill when selected, fainter on hover.
struct NavigatorRowHighlight: ViewModifier {
  @Environment(\.theme) private var theme
  let selected: Bool
  @State private var hovering = false

  func body(content: Content) -> some View {
    content
      .onHover { hovering = $0 }
      .clickable()
      .listRowBackground(
        RoundedRectangle(cornerRadius: 6)
          .fill(selected || hovering ? theme.selection.opacity(selected ? 1 : 0.55) : .clear)
          .padding(.horizontal, 6))
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
    .navigatorList()
    .overlay {
      if entries.isEmpty {
        QuietEmptyState(icon: "checkmark.circle", title: "No changes", message: "Files the session changes show here.")
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
    .navigatorList()
    .overlay {
      if code.fileTree.isEmpty {
        if code.fileListLoading {
          ProgressView().controlSize(.small)
        } else {
          QuietEmptyState(icon: Icon.file, title: "No files")
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
            Spacer(minLength: 0)
          }
          .font(.scaled(size: 12))
          .contentShape(Rectangle())
          .modifier(NavigatorRowHighlight(selected: false))
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
    .modifier(NavigatorRowHighlight(selected: selected))
    .help(path)
  }
}
