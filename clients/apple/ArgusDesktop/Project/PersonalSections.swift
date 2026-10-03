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

  var body: some View {
    SectionIntro(
      title: "Worktree location",
      text: "Where this project's worktrees are created. Stored in ~/.argus/user-project-settings.json — not in .argus.json — so it stays personal: your drives are not the team's."
    )
    WorktreeLocationField(
      settings: settings, purpose: .user, label: "Worktree location", value: settings.worktreeBase,
      defaultPath: settings.worktreeDefault,
      caption: "Argus creates <this folder>/<Repo>-argus-worktrees/ underneath. Leave it empty to use \(settings.worktreeDefault)."
    )
    WorktreeLocationField(
      settings: settings, purpose: .automation, label: "Automation worktree location",
      value: settings.automationWorktreeBase, defaultPath: settings.automationWorktreeDefault,
      caption: "Where automations working on this project create their worktrees. Leave it empty to use the location above."
    )
  }
}

/// One base directory: validated as you type, picked with a native panel, and
/// on save offered a move of the worktrees already at the old location.
private struct WorktreeLocationField: View {
  let settings: ProjectSettingsModel
  let purpose: ArgusProtocol.WorktreePurpose
  let label: String
  let value: String
  let defaultPath: String
  let caption: String
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var draft = ""
  @State private var probe: ArgusProtocol.WorktreeLocationProbe?
  @State private var moving: String?

  private var trimmed: String { draft.trimmingCharacters(in: .whitespaces) }

  var body: some View {
    Section {
      HStack {
        TextField(label, text: $draft, prompt: Text(defaultPath)).labelsHidden()
          .font(.system(.body, design: .monospaced))
        Button("Browse…") {
          Task { if let path = await FolderPicker.pick(prompt: "Use this folder") { draft = path } }
        }
        if !trimmed.isEmpty { Button("Use default") { draft = "" } }
        Button("Save") { moving = trimmed.isEmpty ? defaultPath : trimmed }
          .disabled(trimmed == value.trimmingCharacters(in: .whitespaces) || probe?.reason != nil)
      }
      if let reason = probe?.reason {
        Label(reason, systemImage: "xmark.octagon.fill").foregroundStyle(theme.error)
      } else if probe?.removable == true {
        Label(
          "\(probe?.volumeLabel ?? "This") is a removable drive. When it isn't connected, this project's sessions stay in the sidebar but can't be opened.",
          systemImage: "exclamationmark.triangle.fill"
        )
        .foregroundStyle(theme.warning)
      } else if !trimmed.isEmpty, probe?.exists == false {
        Label("That folder doesn't exist yet — Argus creates it with the first session.", systemImage: "info.circle")
          .foregroundStyle(theme.textSecondary)
      }
    } header: {
      Text(label)
    } footer: {
      Text(caption)
    }
    .onAppear { draft = value }
    .onChange(of: value) { _, next in draft = next }
    .task(id: trimmed) { await runProbe() }
    .sheet(item: Binding(get: { moving.map(RepoPath.init) }, set: { moving = $0?.path })) { target in
      MoveWorktreesSheet(repoRoot: settings.repoRoot, toBaseDir: target.path, purpose: purpose) {
        let next = trimmed
        Task {
          guard let backend = model.backend else { return }
          await settings.commitWorktreeBase(next, purpose: purpose, backend)
        }
      }
    }
  }

  /// Debounced: it stats the filesystem.
  private func runProbe() async {
    guard !trimmed.isEmpty else { return probe = nil }
    try? await Task.sleep(for: .milliseconds(300))
    guard !Task.isCancelled, let backend = model.backend else { return }
    probe = try? await backend.request(
      ArgusProtocol.Commands.ProbeWorktreeLocation.self, .init(baseDir: trimmed, repoRoot: settings.repoRoot))
  }
}
