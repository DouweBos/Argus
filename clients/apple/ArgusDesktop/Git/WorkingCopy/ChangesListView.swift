import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// Conflicted / Staged / Unstaged files in one lazy list, with Finder-style
/// multi-selection driven by the view model.
struct ChangesListView: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  var onShowFileHistory: ((String) -> Void)?
  @State private var filter = ""
  @FocusState private var listFocused: Bool

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var actions: WorkingCopyActions { WorkingCopyActions(workspace: workspace) }

  var body: some View {
    VStack(spacing: 0) {
      PanelHeader(title: "Files", detail: vm.changedCount == 0 ? nil : "\(vm.changedCount) changed") {
        viewModeMenu
        optionsMenu
      }
      if vm.changedCount > 0 || vm.fileViewMode == .allFiles || !filter.isEmpty {
        TextField("Filter", text: $filter)
          .quietField()
          .padding(.horizontal, 8)
          .padding(.vertical, 6)
      }
      if vm.lfs.status.isMissing, !workspace.suppressLfsWarning {
        Text(LFSStatus.missingMessage)
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textSecondary)
          .padding(8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(theme.warningSoft)
      }
      content
    }
    .sheet(item: Binding(get: { vm.patchApply }, set: { if $0 == nil { vm.cancelApplyPatch() } })) { request in
      PatchApplySheet(workspace: workspace, request: request)
    }
  }

  /// List, tree or every tracked file, as Grove's Files header picks it.
  private var viewModeMenu: some View {
    Menu {
      Picker("View", selection: viewMode) {
        Label("List", systemImage: FileViewMode.flatModified.symbol).tag(FileViewMode.flatModified)
        Label("Tree", systemImage: FileViewMode.treeModified.symbol).tag(FileViewMode.treeModified)
        Label("All Files", systemImage: FileViewMode.allFiles.symbol).tag(FileViewMode.allFiles)
      }
      .pickerStyle(.inline)
    } label: {
      Image(systemName: vm.fileViewMode.symbol)
    }
    .menuStyle(.button)
    .clickable()
    .buttonStyle(FlatIconButtonStyle(size: 22))
    .menuIndicator(.hidden)
    .fixedSize()
    .help("View Mode")
    .accessibilityLabel("View Mode")
  }

  private var optionsMenu: some View {
    Menu {
      Button("Stage All") { Task { await actions.stageAll() } }
        .disabled(vm.unstagedFiles.isEmpty)
      Button("Unstage All") { Task { await actions.unstageAll() } }
        .disabled(vm.stagedFiles.isEmpty)
      // The patch file is on this Mac; a remote session's git can't read it.
      if !workspace.isRemote {
        Divider()
        Button("Apply Patch…") { PatchPanels.chooseToApply(workspace: workspace) }
      }
    } label: {
      Image(systemName: "ellipsis")
    }
    .menuStyle(.button)
    .clickable()
    .buttonStyle(FlatIconButtonStyle(size: 22))
    .menuIndicator(.hidden)
    .fixedSize()
    .help("File Options")
    .accessibilityLabel("File Options")
  }

  private var viewMode: Binding<FileViewMode> {
    Binding(get: { vm.fileViewMode }, set: { mode in Task { await vm.setFileViewMode(mode) } })
  }

  @ViewBuilder
  private var content: some View {
    let items = ChangeItem.build(vm, filter: filter)
    if items.isEmpty {
      Group {
        if !vm.hasLoadedStatus {
          ProgressView().controlSize(.small)
        } else if !filter.isEmpty {
          QuietEmptyState(icon: "magnifyingglass", title: "No matches", message: "Nothing matches \u{201C}\(filter)\u{201D}.")
        } else {
          // The diff pane carries the "Nothing to Commit" state.
          Text(vm.fileViewMode == .allFiles ? "Nothing is tracked yet" : "No changed files")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      let selection = ChangeSelection(vm: vm, items: items)
      ScrollViewReader { proxy in
        // Rows take clicks and keys themselves and draw the view model's selection quietly.
        List(items) { item in
          row(item, selected: selection.selectedIDs.contains(item.id))
        }
        .navigatorList()
        .focused($listFocused)
        .onKeyPress(.space) {
          Task { await actions.toggleSelection() }
          return .handled
        }
        .onKeyPress(keys: [.upArrow, .downArrow]) { press in
          let offset = press.key == .upArrow ? -1 : 1
          Task { await vm.moveSelection(by: offset, extend: press.modifiers.contains(.shift)) }
          return .handled
        }
        .onChange(of: focusedID) { _, id in
          if let id { proxy.scrollTo(id) }
        }
      }
    }
  }

  /// The row the diff shows, as a list id.
  private var focusedID: String? {
    guard let entry = vm.selectedEntry else { return nil }
    let section: ChangeSection = entry.isConflicted ? .conflicted : (vm.selectedSide == .staged ? .staged : .unstaged)
    return ChangeItem.fileID(entry.path, section)
  }

  @ViewBuilder
  private func row(_ item: ChangeItem, selected: Bool) -> some View {
    switch item.kind {
    case .header(let section, let count):
      header(section, count: count).selectionDisabled()
    case .directory(let directory, _):
      Label { Text(directory) } icon: { FileTypeIcon(path: directory, isDirectory: true, isExpanded: true, size: 14) }
        .font(.scaled(size: 11, design: .monospaced))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.head)
        .selectionDisabled()
    case .file(let entry, let section, let showsDirectory):
      fileRow(entry, section: section, showsDirectory: showsDirectory)
        .modifier(NavigatorRowHighlight(selected: selected))
    case .tracked(let path):
      TrackedFileRow(path: path)
        .modifier(NavigatorRowHighlight(selected: false))
        .contextMenu { TrackedFileMenu(workspace: workspace, path: path, onShowFileHistory: onShowFileHistory) }
    }
  }

  private func header(_ section: ChangeSection, count: Int) -> some View {
    HStack {
      SectionLabel(section.rawValue, count: count)
      Spacer()
      switch section {
      case .staged:
        Button("Unstage All") { Task { await actions.unstageAll() } }
          .buttonStyle(QuietTabButtonStyle())
      case .unstaged:
        Button("Stage All") { Task { await actions.stageAll() } }
          .buttonStyle(QuietTabButtonStyle())
      case .conflicted:
        EmptyView()
      }
    }
    .padding(.top, 4)
  }

  private func fileRow(_ entry: StatusEntry, section: ChangeSection, showsDirectory: Bool) -> some View {
    Button {
      click(entry, section: section)
    } label: {
      ChangeRow(
        entry: entry, section: section, showsDirectory: showsDirectory, isLFS: vm.isLFS(entry),
        toggleStage: {
          Task { section == .staged ? await actions.unstage(entry) : await actions.stage(entry) }
        }
      )
    }
    .buttonStyle(.argusPlain)
    .padding(.leading, showsDirectory || entry.directory.isEmpty ? 0 : 14)
    .contextMenu {
      ChangeRowMenu(workspace: workspace, entry: entry, section: section, onShowFileHistory: onShowFileHistory)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(entry.path)
  }

  /// Rows take the click themselves so ⇧/⌘ reach the view model as Finder does them.
  private func click(_ entry: StatusEntry, section: ChangeSection) {
    listFocused = true
    let flags = NSApp.currentEvent?.modifierFlags ?? []
    Task {
      await vm.click(entry, side: section.side, extend: flags.contains(.shift), toggle: flags.contains(.command))
    }
  }
}
