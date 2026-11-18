import ArgusUI
import SwiftUI

/// Every field of a blueprint as list sections, for the editor. The phone has
/// no folder picker, so folders are typed paths on the computer.
struct BlueprintFormSections: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  @Binding var form: BlueprintForm
  let runners: [RemoteRunner]

  var body: some View {
    basics
    references
    scaffold
    github
    agent
    instructions
  }

  private var basics: some View {
    Section {
      TextField("Name", text: $form.name, prompt: prompt("Name"))
        .textInputAutocapitalization(.words)
      TextField("Summary", text: $form.summary, prompt: prompt("What it makes"), axis: .vertical)
        .lineLimit(1...3)
      LabeledContent("Folder") {
        TextField("Folder", text: $form.parentDir, prompt: prompt("~/Work"))
          .font(.scaled(size: 14, design: .monospaced))
          .multilineTextAlignment(.trailing)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }
    } footer: {
      Text("New projects are created inside this folder on the computer.")
    }
  }

  // MARK: References

  private var unreferenced: [RemoteProject] {
    host.projects.filter { project in !form.references.contains { $0.path == project.repoRoot } }
  }

  private var references: some View {
    Section {
      ForEach($form.references) { $reference in
        HStack(alignment: .top, spacing: 12) {
          Image(systemName: Icon.folder)
            .font(.scaled(size: 15))
            .foregroundStyle(theme.textSecondary)
            .frame(width: 22)
            .padding(.top, 2)
          VStack(alignment: .leading, spacing: 4) {
            Text(reference.name).lineLimit(1)
            TextField("Note", text: $reference.note, prompt: prompt("What to take from it"), axis: .vertical)
              .font(.scaled(.footnote))
              .lineLimit(1...3)
          }
        }
      }
      .onDelete { offsets in
        for path in offsets.map({ form.references[$0].path }) { form.removeReference(path) }
      }
      Menu {
        ForEach(unreferenced) { project in
          Button(project.name) { form.addReference(project.repoRoot) }
        }
      } label: {
        Label("Add Project", systemImage: Icon.plus)
      }
      .disabled(unreferenced.isEmpty)
    } header: {
      Text("Reference projects")
    } footer: {
      Text("The agent reads these first and copies their layout, tooling and setup.")
    }
  }

  // MARK: Scaffold and GitHub

  private var scaffold: some View {
    Section {
      Picker("Start from", selection: $form.scaffold) {
        ForEach(BlueprintForm.ScaffoldKind.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
      if form.scaffold == .githubTemplate {
        TextField("Template", text: $form.templateRepo, prompt: prompt("owner/name"))
          .font(.scaled(size: 14, design: .monospaced))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }
    } header: {
      Text("Scaffold")
    }
  }

  private var github: some View {
    Section {
      Toggle("Create a GitHub repository", isOn: $form.githubEnabled)
        .toggleStyle(.argusSwitch)
      if form.githubEnabled {
        LabeledContent("Owner") {
          TextField("Owner", text: $form.owner, prompt: prompt("Your account"))
            .multilineTextAlignment(.trailing)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        Picker("Visibility", selection: $form.visibility) {
          ForEach(BlueprintForm.Visibility.allCases, id: \.self) { Text($0.label).tag($0) }
        }
      }
      Picker("Copy project settings", selection: $form.copySettingsFrom) {
        Text("None").tag(String?.none)
        ForEach(form.references) { Text($0.name).tag(Optional($0.path)) }
      }
    } header: {
      Text("Repository")
    } footer: {
      Text("Project settings are the setup steps, run commands and other checked-in Argus settings.")
    }
  }

  // MARK: Agent and instructions

  private var selectedRunner: RemoteRunner? {
    form.runner.flatMap { id in runners.first { $0.id == id } }
  }

  private var agent: some View {
    Section("First agent") {
      if !runners.isEmpty {
        Picker("Runner", selection: runnerBinding) {
          Text("Default").tag("")
          ForEach(runners, id: \.id) { Text($0.displayName).tag($0.id) }
        }
      }
      if let models = selectedRunner?.models, !models.isEmpty {
        Picker("Model", selection: modelBinding) {
          Text("Default").tag("")
          ForEach(models, id: \.value) { Text($0.displayName).tag($0.value) }
        }
      } else {
        LabeledContent("Model") {
          TextField("Model", text: modelBinding, prompt: prompt("Default"))
            .font(.scaled(size: 14, design: .monospaced))
            .multilineTextAlignment(.trailing)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
      }
    }
  }

  private var instructions: some View {
    Section {
      TextField(
        "Instructions", text: $form.instructions, prompt: prompt("What the first agent should do"), axis: .vertical
      )
      .font(.scaled(size: 14, design: .monospaced))
      .lineLimit(6...24)
    } header: {
      Text("Instructions")
    } footer: {
      Text("Markdown. {{name}}, {{description}}, {{repo}} and {{path}} are filled in for each project.")
    }
  }

  /// Model ids don't carry across runners, so a switch drops the model.
  private var runnerBinding: Binding<String> {
    Binding(
      get: { form.runner ?? "" },
      set: { id in
        guard id != (form.runner ?? "") else { return }
        form.runner = id.isEmpty ? nil : id
        form.model = nil
      })
  }

  private var modelBinding: Binding<String> {
    Binding(get: { form.model ?? "" }, set: { form.model = $0.isEmpty ? nil : $0 })
  }

  private func prompt(_ text: String) -> Text {
    Text(text).foregroundStyle(theme.textMuted)
  }
}
