#if DEBUG
  import ArgusCore
  import ArgusUI
  import GroveKit
  import GroveUIKit
  import SwiftUI

  /// GroveUIKit's git dialogs as Argus shows them, on the gallery's repository: every dialog, a worktree
  /// session that can't merge, another colour theme and a larger Display size.
  enum GitDialogStories {
    static var all: [GalleryStory] {
      [
        story("fetch", .fetch), story("pull", .pull), story("push", .push()), story("publish", .push(branch: "fix/terminal-resize-flicker")),
        story("sync", .sync), story("create-branch", .createBranch()), story("rename-branch", .renameBranch("fix/terminal-resize-flicker")),
        story("rename-session-branch", .renameCurrentBranch, worktree: true),
        story("delete-branch", .deleteBranch(branch("fix/terminal-resize-flicker"))),
        story("track", .trackRemoteBranch(branch("fix/terminal-resize-flicker"))), story("merge", .merge),
        story("merge-in-worktree", .merge, worktree: true), story("rebase", .rebase), story("stash", .stash()),
        story("snapshot", .snapshot), story("tag", .createTag()), story("add-remote", .addRemote),
        story("edit-remote", .editRemote(RemoteInfo(id: "origin", name: "origin", url: "git@github.com:acme/luma.git"))),
        story("branch-from-stash", .branchFromStash(index: 0)),
        story("push-theme", .push(), colorTheme: .ocean), story("push-zoom", .push(), scale: 17.0 / 13),
        story("pull-zoom", .pull, scale: 17.0 / 13),
      ]
    }

    /// The branch as the dialog would be handed it; its tip doesn't show.
    private static func branch(_ name: String) -> BranchInfo {
      BranchInfo(
        id: "refs/heads/\(name)", name: name, isLocal: true, isRemote: false, isHEAD: false, targetSHA: "", ahead: 0,
        behind: 0)
    }

    private static func story(
      _ id: String, _ dialog: GitDialog, worktree: Bool = false, colorTheme: ColorTheme? = nil, scale: CGFloat = 1
    ) -> GalleryStory {
      let sessionId = worktree ? GalleryGit.worktreeSessionId : GalleryGit.rootSessionId
      let path = worktree ? GitStories.worktreePath : GitStories.rootPath
      return GalleryStory(
        "git/dialog/\(id)", size: CGSize(width: 620 * scale, height: 0),
        fixtures: GalleryFixtures.git(sessionId: sessionId, path: path),
        setup: { stage in
          await GitStories.attach(stage)
          guard let session = stage.host.session(id: sessionId), let workspace = await stage.model.git.open(session) else {
            return
          }
          await workspace.refreshAll()
        }
      ) {
        DialogStory(sessionId: sessionId, dialog: dialog, colorTheme: colorTheme, scale: scale)
      }
    }
  }

  private struct DialogStory: View {
    @Environment(DesktopModel.self) private var model
    @Environment(HostStore.self) private var host
    @Environment(\.theme) private var theme
    let sessionId: String
    let dialog: GitDialog
    let colorTheme: ColorTheme?
    let scale: CGFloat

    var body: some View {
      let theme = colorTheme.map { Theme.resolved(for: theme.scheme, colorTheme: $0) } ?? theme
      if let session = host.session(id: sessionId), let workspace = model.git.workspace(sessionId) {
        GitDialogView(dialog, context: RefActions(workspace: workspace, session: session, model: model).dialogContext)
          .gitUIStyle(.argus(theme, scale: scale))
          .environment(\.theme, theme)
          .tint(theme.tint)
          .frame(maxWidth: .infinity)
          .background(theme.bg)
      }
    }
  }
#endif
