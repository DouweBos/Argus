import AppKit
import ArgusCore
import GroveKit
import GroveUIKit

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
