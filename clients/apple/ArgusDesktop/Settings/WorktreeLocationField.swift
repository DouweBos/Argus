import ArgusCore
import SwiftUI

/// The base folder worktrees are created in: typed or browsed, probed as you
/// type so a bad or removable location is called out before it's saved.
/// Shared by App Settings and Project Settings, as on the desktop; editing one
/// project's location also offers to move the worktrees already there.
struct WorktreeLocationField: View {
  @Environment(DesktopModel.self) private var model
  let label: String
  var caption: String?
  let defaultPath: String
  let value: String
  var purpose: ArgusProtocol.WorktreePurpose = .user
  /// Set when the field edits a single project.
  var repoRoot: String?
  let commit: (String) async -> Void

  @State private var draft = ""
  @State private var probe: ArgusProtocol.WorktreeLocationProbe?
  @State private var saving = false
  @State private var moving: String?

  private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var dirty: Bool { trimmed != value.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
      HStack {
        TextField(label, text: $draft, prompt: Text(defaultPath))
          .labelsHidden()
          .textFieldStyle(.roundedBorder)
          .font(.system(.body, design: .monospaced))
        Button("Browse…") {
          Task { if let path = await model.pickFolder(prompt: "Use this folder", on: repoRoot.map(model.host(ofProject:))) { draft = path } }
        }
        if !trimmed.isEmpty {
          Button("Use Default") { draft = "" }
        }
        Button(saving ? "Saving…" : "Save", action: save)
          .disabled(!dirty || probe?.reason != nil || saving)
      }
      SettingsCaption(
        caption
          ?? "Argus creates <this folder>/<Repo>-argus-worktrees/ underneath. Leave it empty to use \(defaultPath)."
      )
      if let reason = probe?.reason {
        SettingsError(text: reason)
      } else if probe?.removable == true {
        SettingsCaption(
          "\(probe?.volumeLabel ?? "This") is a removable drive. When it isn't connected, this "
            + "project's sessions stay in the sidebar but can't be opened.")
      } else if !trimmed.isEmpty, probe?.exists == false {
        SettingsCaption("That folder doesn't exist yet — Argus creates it with the first session.")
      }
    }
    .onAppear { draft = value }
    .onChange(of: value) { _, next in draft = next }
    .task(id: trimmed) {
      guard !trimmed.isEmpty else { return probe = nil }
      // Debounced: this stats the filesystem on every keystroke otherwise.
      try? await Task.sleep(for: .milliseconds(300))
      guard !Task.isCancelled, let backend = model.backend else { return }
      probe = try? await backend.request(
        ArgusProtocol.Commands.ProbeWorktreeLocation.self, .init(baseDir: trimmed, repoRoot: repoRoot))
    }
    .sheet(item: Binding(get: { moving.map(RepoPath.init) }, set: { moving = $0?.path })) { target in
      if let repoRoot {
        MoveWorktreesSheet(repoRoot: repoRoot, toBaseDir: target.path, purpose: purpose, onClose: write)
      }
    }
  }

  /// A project's location first offers the move; the new value is saved either way.
  private func save() {
    if repoRoot != nil {
      moving = trimmed.isEmpty ? defaultPath : trimmed
    } else {
      write()
    }
  }

  private func write() {
    saving = true
    let next = trimmed
    Task {
      await commit(next)
      saving = false
    }
  }
}
