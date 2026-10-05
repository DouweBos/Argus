import AppKit
import ArgusUI
import GroveKit
import SwiftUI
import UniformTypeIdentifiers

/// The open and save panels behind Create Patch and Apply Patch.
@MainActor
enum PatchPanels {
  static func chooseToApply(workspace: GitWorkspace) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.message = "Choose a patch to apply to the working tree"
    present(panel) { response in
      guard response == .OK, let url = DevPanelPath.url ?? panel.url else { return }
      Task { await workspace.workingCopy.beginApplyPatch(url) }
    }
  }

  static func create(workspace: GitWorkspace, entries: [StatusEntry], side: DiffSide) {
    let vm = workspace.workingCopy
    let panel = NSSavePanel()
    panel.nameFieldStringValue = vm.suggestedPatchName(for: entries)
    panel.allowedContentTypes = [UTType(filenameExtension: "patch") ?? .plainText]
    present(panel) { response in
      guard response == .OK, let url = DevPanelPath.url ?? panel.url else { return }
      Task {
        vm.clearError()
        await vm.createPatch(from: entries, side: side, to: url)
        workspace.track(.patchCreate, success: vm.errorMessage == nil)
      }
    }
  }

  private static func present(_ panel: NSSavePanel, then finish: @escaping (NSApplication.ModalResponse) -> Void) {
    #if DEBUG
      // A driven dev build can't click through a panel; it names the file instead.
      if let path = ProcessInfo.processInfo.environment["ARGUS_DEV_PANEL_PATH"] {
        panel.directoryURL = URL(fileURLWithPath: path).deletingLastPathComponent()
        panel.nameFieldStringValue = URL(fileURLWithPath: path).lastPathComponent
        DevPanelPath.url = URL(fileURLWithPath: path)
        return finish(.OK)
      }
    #endif
    if let window = NSApp.keyWindow {
      panel.beginSheetModal(for: window, completionHandler: finish)
    } else {
      finish(panel.runModal())
    }
  }
}

/// The file a driven dev build named in place of a panel; always nil in release.
@MainActor
enum DevPanelPath {
  #if DEBUG
    static var url: URL?
  #else
    static let url: URL? = nil
  #endif
}

/// A chosen patch, checked with `git apply --check` before it can be applied.
struct PatchApplySheet: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  let request: PatchApplyRequest

  private var vm: WorkingCopyViewModel { workspace.workingCopy }
  private var current: PatchApplyRequest { vm.patchApply ?? request }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Apply “\(current.file.lastPathComponent)”").font(.headline)
      Toggle(
        "Stage the changes too (git apply --index)",
        isOn: Binding(get: { current.toIndex }, set: { on in Task { await vm.setPatchAppliesToIndex(on) } }))
      .toggleStyle(.checkbox)
      .disabled(current.isApplying)
      status
      HStack {
        Spacer()
        Button("Cancel", role: .cancel) { vm.cancelApplyPatch() }
          .keyboardShortcut(.cancelAction)
        Button(current.isApplying ? "Applying…" : "Apply") {
          Task {
            await vm.applyPendingPatch()
            workspace.track(.patchApply, success: vm.patchApply == nil)
          }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(!current.canApply)
      }
    }
    .padding(20)
    .frame(width: 460)
  }

  @ViewBuilder private var status: some View {
    switch current.check {
    case .checking:
      HStack(spacing: 6) {
        ProgressView().controlSize(.small)
        Text("Checking the patch…").foregroundStyle(theme.textMuted)
      }
    case .applies:
      Label("The patch applies cleanly.", systemImage: "checkmark.circle").foregroundStyle(theme.success)
    case .fails(let detail):
      VStack(alignment: .leading, spacing: 4) {
        Label("The patch doesn't apply.", systemImage: "xmark.octagon").foregroundStyle(theme.error)
        ScrollView {
          Text(detail)
            .font(.system(size: 11, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 140)
      }
    }
  }
}

/// Create Patch and the Git LFS items of a Changes row's menu.
struct ChangeLFSAndPatchMenu: View {
  let workspace: GitWorkspace
  let entry: StatusEntry
  let section: ChangeSection
  let entries: [StatusEntry]

  var body: some View {
    let items = Self.items(workspace: workspace, entry: entry, section: section, entries: entries)
    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
      if item.startsGroup, index > 0 { Divider() }
      Button(item.title, action: item.run)
    }
  }

  struct Item {
    let title: String
    let startsGroup: Bool
    let run: @MainActor () -> Void
  }

  /// What the menu offers, shared with the dev driver, which can't open a context menu.
  static func items(
    workspace: GitWorkspace, entry: StatusEntry, section: ChangeSection, entries: [StatusEntry]
  ) -> [Item] {
    let vm = workspace.workingCopy
    var items: [Item] = []
    if section != .conflicted, !workspace.isRemote {
      let patchEntries = vm.patchEntries(for: entry, side: section.side)
      items.append(
        Item(
          title: patchEntries.count > 1 ? "Create Patch from \(patchEntries.count) Files…" : "Create Patch…",
          startsGroup: false
        ) { PatchPanels.create(workspace: workspace, entries: patchEntries, side: section.side) })
    }
    let candidates = vm.lfsCandidates(entries)
    if !candidates.isEmpty, !vm.lfs.status.isMissing {
      let track = { (byExtension: Bool) in
        Task {
          vm.clearError()
          await vm.trackWithLFS(candidates, byExtension: byExtension)
          workspace.track(.lfsTrack, success: vm.errorMessage == nil)
        }
      }
      items.append(
        Item(
          title: candidates.count > 1 ? "Track \(candidates.count) Files with Git LFS" : "Track with Git LFS",
          startsGroup: true
        ) { _ = track(false) })
      if let pattern = WorkingCopyViewModel.lfsExtensionPattern(for: candidates) {
        items.append(Item(title: "Track All “\(pattern)” Files with Git LFS", startsGroup: false) { _ = track(true) })
      }
    }
    return items
  }
}

/// An unchanged file in the All Files list.
struct TrackedFileRow: View {
  let path: String

  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "doc").foregroundStyle(.tertiary).frame(width: 16)
      Text((path as NSString).lastPathComponent).lineLimit(1)
      let directory = (path as NSString).deletingLastPathComponent
      if !directory.isEmpty {
        Text(directory).foregroundStyle(.secondary).lineLimit(1).truncationMode(.head)
      }
      Spacer(minLength: 0)
    }
    .font(.system(size: 12))
    .help(path)
    .selectionDisabled()
  }
}

struct TrackedFileMenu: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let path: String
  var onShowFileHistory: ((String) -> Void)?

  var body: some View {
    if let onShowFileHistory {
      Button("File History") { onShowFileHistory(path) }
    }
    Button("Blame") { model.navigate(.sessionGit(id: workspace.sessionId, view: .blame(path: path, ref: nil))) }
    Divider()
    Button("Copy Path") { Clipboard.copy(path) }
    if !workspace.isRemote {
      Button("Reveal in Finder") {
        NSWorkspace.shared.activateFileViewerSelecting([workspace.repository.path.appendingPathComponent(path)])
      }
    }
  }
}
