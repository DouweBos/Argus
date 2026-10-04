import ArgusCore
import ArgusUI
import SwiftUI

struct BranchPrefixSection: View {
  @Bindable var settings: ProjectSettingsModel

  var body: some View {
    SectionIntro(
      title: "Personal branch prefix",
      text: "Prepended to every new branch you create in this project. Stored in ~/.argus/user-project-settings.json — not in .argus.json — so it stays personal and is not shared with the team."
    )
    Section {
      TextField("Branch prefix", text: $settings.branchPrefix, prompt: Text("yourname/"))
    } footer: {
      Text(
        "Example: yourname/ turns a branch name like fix-login into yourname/fix-login. Leave empty to disable. You can also edit this inline when creating a session."
      )
    }
  }
}

struct WorktreeLocationSection: View {
  let settings: ProjectSettingsModel
  @Environment(DesktopModel.self) private var model

  var body: some View {
    SectionIntro(
      title: "Worktree location",
      text: "Where this project's worktrees are created. Stored in ~/.argus/user-project-settings.json — not in .argus.json — so it stays personal: your drives are not the team's."
    )
    Section {
      WorktreeLocationField(
        label: "Worktree location", defaultPath: settings.worktreeDefault, value: settings.worktreeBase,
        repoRoot: settings.repoRoot
      ) { await commit($0, .user) }
    }
    Section {
      WorktreeLocationField(
        label: "Automation worktree location",
        caption: "Where automations working on this project create their worktrees. Leave it empty to use the location above.",
        defaultPath: settings.automationWorktreeDefault, value: settings.automationWorktreeBase,
        purpose: .automation, repoRoot: settings.repoRoot
      ) { await commit($0, .automation) }
    }
  }

  private func commit(_ value: String, _ purpose: ArgusProtocol.WorktreePurpose) async {
    guard let backend = model.backend else { return }
    await settings.commitWorktreeBase(value, purpose: purpose, backend)
  }
}
