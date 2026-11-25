import ArgusCore
import ArgusUI
import SwiftUI

/// Where Clone Repository puts a new clone first. Each clone also remembers
/// its folder here, so this is usually the last place you cloned into.
struct CloneLocationSection: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(DesktopModel.self) private var model
  @State private var draft = ""

  private var saved: String { host.settings?.cloneParentDir ?? "" }
  private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    SettingsGroup("Projects") {
      SettingsRow(
        "Clone location",
        description: "The folder Clone Repository offers first. It follows the last folder you cloned into; "
          + "leave it empty to use the folder most of your projects are in, or ~/Developer.",
        stacked: true
      ) {
        HStack {
          TextField("Clone location", text: $draft, prompt: Text("~/Developer"))
            .textFieldStyle(.roundedBorder)
            .font(.system(.body, design: .monospaced))
            .onSubmit(save)
          Button("Browse") {
            Task { if let path = await model.pickFolder(prompt: "Clone Here", start: trimmed) { draft = path } }
          }
          Button("Save", action: save).disabled(trimmed == saved || !host.loaded)
        }
      }
    }
    .onAppear { draft = saved }
    .onChange(of: saved) { _, next in draft = next }
  }

  private func save() {
    let next = trimmed
    Task {
      await host.save(.cloneLocation, ["clone_parent_dir": .string(next)]) { $0.cloneParentDir = next }
    }
  }
}
