import AppKit
import ArgusCore
import GroveKit
import GroveUIKit
import SwiftUI

extension GitWorkingCopyHost {
  /// What Argus does for the kit's working copy: its code view, saved profiles, the shared dialogs,
  /// panels a driven dev build can name, the ⌘↩ router's focus and telemetry.
  @MainActor
  static func argus(workspace: GitWorkspace, session: RemoteSession, model: DesktopModel) -> GitWorkingCopyHost {
    var host = GitWorkingCopyHost()
    let sessionId = workspace.sessionId
    host.openFile = { [model] path in model.openCode(session: sessionId, path: path, source: .changes) }
    host.profiles = GitIdentityProfiles(
      load: { CommitPreferences.profiles() },
      save: { identity, label in
        CommitPreferences.setProfiles(IdentityProfiles.adding(identity, label: label, to: CommitPreferences.profiles()))
      },
      remove: { profile in
        CommitPreferences.setProfiles(IdentityProfiles.removing(profile.id, from: CommitPreferences.profiles()))
      })
    host.present = { [model] dialog in RefActions(workspace: workspace, session: session, model: model).present(dialog) }
    host.choosePatch = { await PatchPanels.chooseFile() }
    host.choosePatchDestination = { name, message in await PatchPanels.chooseDestination(name: name, message: message) }
    host.onMessageFocus = { [weak workspace] in workspace?.commitMessageFocused = $0 }
    host.onEvent = { [weak workspace] event in
      switch event {
      case .templateInserted: workspace?.track(.template, success: true)
      case .gitmojiInserted: workspace?.track(.gitmoji, success: true)
      case .patchCreated(let succeeded): workspace?.track(.patchCreate, success: succeeded)
      }
    }
    // The banner over the view shows failures with their fixes.
    host.showsErrors = false
    return host
  }
}

extension GitWorkingCopySlots {
  /// Argus's parts of the working copy wherever it shows: the diff scope and its files and diff, the review-aware diff
  /// with viewed marks when `viewed` is given, and File History and Blame in a file's menu.
  @MainActor
  static func argus(workspace: GitWorkspace, viewed: ViewedFiles? = nil, onShowFileHistory: ((String) -> Void)? = nil)
    -> GitWorkingCopySlots
  {
    var slots = GitWorkingCopySlots()
    slots.filesHeader = AnyView(DiffScopeMenu(workspace: workspace))
    slots.diff = { _ in AnyView(WorkingDiffView(workspace: workspace, viewed: viewed)) }
    slots.rowMenu = { entry, entries in
      AnyView(
        FileHistoryItems(
          workspace: workspace, path: entries.count == 1 && entry.isKnownToGit ? entry.path : nil,
          onShowFileHistory: onShowFileHistory))
    }
    slots.trackedFileMenu = { path in
      AnyView(FileHistoryItems(workspace: workspace, path: path, onShowFileHistory: onShowFileHistory))
    }
    if let viewed {
      slots.rowAccessory = { entry in AnyView(ViewedMark(state: viewed.state(entry.path))) }
      let paths = Set(workspace.workingCopy.statusEntries.map(\.path))
      if !paths.isEmpty {
        slots.filesDetail = "\(paths.count) changed · \(viewed.viewedCount(Array(paths))) viewed"
      }
    }
    if workspace.scopedDiff.scope != .uncommitted {
      slots.replacement = (
        files: AnyView(ScopedChangesList(workspace: workspace)), detail: AnyView(ScopedDiffPane(workspace: workspace))
      )
    }
    return slots
  }
}

extension StatusEntry {
  /// Git has a history for it: not untracked or newly added.
  fileprivate var isKnownToGit: Bool { workdirStatus != .untracked && indexStatus != .added }
}

/// File History and Blame for a file git already knows; nothing for a path it doesn't.
private struct FileHistoryItems: View {
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace
  let path: String?
  var onShowFileHistory: ((String) -> Void)?

  var body: some View {
    if let path {
      if let onShowFileHistory {
        Button("File History") { onShowFileHistory(path) }
      }
      Button("Blame") { model.navigate(.sessionGit(id: workspace.sessionId, view: .blame(path: path, ref: nil))) }
    }
  }
}
