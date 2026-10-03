import ArgusCore
import SwiftUI

/// Your own apps in the "Open In" menu: a CLI on PATH or a `.app` path.
struct CustomEditorsSection: View {
  @State private var prefs = AppPreferences.shared
  @State private var editing: CustomEditor?
  @State private var adding = false

  var body: some View {
    Section {
      if prefs.customEditors.isEmpty {
        Text("No custom apps yet.").foregroundStyle(.secondary)
      }
      ForEach(prefs.customEditors) { editor in
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(editor.name)
            Text(editor.command).font(.caption.monospaced()).foregroundStyle(.secondary)
          }
          Spacer()
          Button("Edit") { editing = editor }
          Button("Remove") {
            prefs.customEditors.removeAll { $0.id == editor.id }
            MacTelemetry.capture(.settingsChanged(setting: .customEditors))
          }
        }
      }
      Button("Add App…") { adding = true }
    } header: {
      Text("Open in apps")
    } footer: {
      SettingsCaption(
        "Show your own apps in the \"Open In\" menu. Command is a CLI on PATH (e.g. zed, subl) or a "
          + "path to a .app bundle.")
    }
    .sheet(isPresented: $adding) {
      CustomEditorSheet(title: "Add App", editor: nil) { name, command in
        guard let editor = CustomEditor.make(name: name, command: command) else { return }
        prefs.customEditors.append(editor)
        MacTelemetry.capture(.settingsChanged(setting: .customEditors))
      }
    }
    .sheet(item: $editing) { editor in
      CustomEditorSheet(title: "Edit App", editor: editor) { name, command in
        guard let index = prefs.customEditors.firstIndex(where: { $0.id == editor.id }) else { return }
        prefs.customEditors[index] = editor.updated(name: name, command: command)
        MacTelemetry.capture(.settingsChanged(setting: .customEditors))
      }
    }
  }
}

private struct CustomEditorSheet: View {
  @Environment(\.dismiss) private var dismiss
  let title: String
  let editor: CustomEditor?
  let save: (String, String) -> Void

  @State private var name = ""
  @State private var command = ""

  private var valid: Bool {
    !name.trimmingCharacters(in: .whitespaces).isEmpty
      && !command.trimmingCharacters(in: .whitespaces).isEmpty
  }

  var body: some View {
    Form {
      TextField("Name", text: $name, prompt: Text("Zed, Warp…"))
      LabeledContent("Command") {
        TextField("Command", text: $command, prompt: Text("Command or .app path"))
          .labelsHidden()
          .font(.body.monospaced())
      }
    }
    .formStyle(.grouped)
    .frame(width: 420)
    .navigationTitle(title)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button(editor == nil ? "Add App" : "Save") {
          save(name, command)
          dismiss()
        }
        .disabled(!valid)
      }
    }
    .onAppear {
      name = editor?.name ?? ""
      command = editor?.command ?? ""
    }
  }
}
