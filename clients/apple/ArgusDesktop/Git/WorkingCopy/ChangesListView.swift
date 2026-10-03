import AppKit
import ArgusUI
import GroveKit
import SwiftUI

/// Conflicted / Staged / Unstaged files in one lazy list, with Finder-style
/// multi-selection driven by the view model.
struct ChangesListView: View {
  let workspace: GitWorkspace
  var onShowFileHistory: ((String) -> Void)?
  @State private var filter = ""
  @FocusState private var listFocused: Bool

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var actions: WorkingCopyActions { WorkingCopyActions(workspace: workspace) }

  var body: some View {
    VStack(spacing: 0) {
      toolbar
      Divider()
      content
    }
  }

  private var toolbar: some View {
    HStack(spacing: 6) {
      TextField("Filter", text: $filter)
        .textFieldStyle(.roundedBorder)
        .controlSize(.small)
      Picker("View", selection: viewMode) {
        Image(systemName: FileViewMode.flatModified.symbol).help("List").tag(FileViewMode.flatModified)
        Image(systemName: FileViewMode.treeModified.symbol).help("Tree").tag(FileViewMode.treeModified)
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .fixedSize()
    }
    .padding(.horizontal, 8)
    .frame(height: 34)
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
          ContentUnavailableView.search(text: filter)
        } else {
          ContentUnavailableView("No changes", systemImage: "checkmark.circle", description: Text("The working tree is clean."))
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else {
      let selection = ChangeSelection(vm: vm, items: items)
      ScrollViewReader { proxy in
        List(
          items,
          selection: Binding(get: { selection.selectedIDs }, set: { ids in Task { await selection.apply(ids) } })
        ) { item in
          row(item)
        }
        .listStyle(.inset)
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
  private func row(_ item: ChangeItem) -> some View {
    switch item.kind {
    case .header(let section, let count):
      header(section, count: count).selectionDisabled()
    case .directory(let directory, _):
      Label(directory, systemImage: "folder")
        .font(.system(size: 11, design: .monospaced))
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .truncationMode(.head)
        .selectionDisabled()
    case .file(let entry, let section, let showsDirectory):
      fileRow(entry, section: section, showsDirectory: showsDirectory)
    }
  }

  private func header(_ section: ChangeSection, count: Int) -> some View {
    HStack {
      Text(section.rawValue).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
      Text("\(count)").font(.system(size: 11).monospacedDigit()).foregroundStyle(.tertiary)
      Spacer()
      switch section {
      case .staged:
        Button("Unstage All") { Task { await actions.unstageAll() } }
          .buttonStyle(.borderless).controlSize(.small)
      case .unstaged:
        Button("Stage All") { Task { await actions.stageAll() } }
          .buttonStyle(.borderless).controlSize(.small)
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
        entry: entry, section: section, showsDirectory: showsDirectory,
        toggleStage: {
          Task { section == .staged ? await actions.unstage(entry) : await actions.stage(entry) }
        }
      )
    }
    .buttonStyle(.plain)
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
