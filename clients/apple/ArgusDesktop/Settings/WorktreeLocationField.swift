import AppKit
import ArgusCore
import SwiftUI

/// The base folder worktrees are created in: typed or browsed, probed as you
/// type so a bad or removable location is called out before it's saved.
struct WorktreeLocationField: View {
  @Environment(DesktopModel.self) private var model
  let label: String
  var caption: String?
  let defaultPath: String
  let value: String
  let commit: (String) async -> Void

  @State private var draft = ""
  @State private var probe: ArgusProtocol.WorktreeLocationProbe?
  @State private var saving = false

  init(
    label: String, caption: String? = nil, defaultPath: String, value: String,
    commit: @escaping (String) async -> Void
  ) {
    self.label = label
    self.caption = caption
    self.defaultPath = defaultPath
    self.value = value
    self.commit = commit
  }

  private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var dirty: Bool { trimmed != value.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label)
      HStack {
        TextField(label, text: $draft, prompt: Text(defaultPath))
          .labelsHidden()
          .textFieldStyle(.roundedBorder)
        Button("Browse…", action: browse)
        if !trimmed.isEmpty {
          Button("Use Default") { draft = "" }
        }
        Button(saving ? "Saving…" : "Save") {
          saving = true
          Task {
            await commit(trimmed)
            saving = false
          }
        }
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
        ArgusProtocol.Commands.ProbeWorktreeLocation.self, .init(baseDir: trimmed))
    }
  }

  private func browse() {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.canCreateDirectories = true
    panel.prompt = "Choose"
    panel.message = "Choose a worktree location"
    if !trimmed.isEmpty { panel.directoryURL = URL(fileURLWithPath: trimmed) }
    if panel.runModal() == .OK, let url = panel.url {
      draft = url.path
    }
  }
}
