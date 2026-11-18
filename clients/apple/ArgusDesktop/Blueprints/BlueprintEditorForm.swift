import ArgusCore
import ArgusUI
import SwiftUI

/// A blueprint's fields as grouped form sections. Saving is the screen's job.
struct BlueprintEditorForm: View {
  @Environment(HostStore.self) private var host
  @Binding var form: BlueprintForm

  var body: some View {
    Section("Blueprint") {
      TextField("Name", text: $form.name, prompt: Text("SwiftUI Mac app"))
      TextField("Summary", text: $form.summary, prompt: Text("Shown in the blueprints list."))
      FolderField(label: "New projects go in", path: $form.parentDir, prompt: "Choose Folder")
    }
    BlueprintReferencesSection(form: $form)
    repository
    instructions
    agent
  }

  private var repository: some View {
    Section {
      Picker("Start from", selection: $form.scaffold) {
        ForEach(BlueprintForm.ScaffoldKind.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      if form.scaffold == .githubTemplate {
        TextField("Template repository", text: $form.templateRepo, prompt: Text("owner/name"))
          .font(.system(.body, design: .monospaced))
      }
      Toggle("Create a GitHub repository", isOn: $form.githubEnabled)
      if form.githubEnabled {
        TextField("Owner", text: $form.owner, prompt: Text("Blank uses your GitHub account"))
        Picker("Visibility", selection: $form.visibility) {
          ForEach(BlueprintForm.Visibility.allCases, id: \.self) { Text($0.label).tag($0) }
        }
        .pickerStyle(.segmented)
      }
      Picker("Copy project settings from", selection: $form.copySettingsFrom) {
        Text("None").tag(String?.none)
        ForEach(form.references) { Text($0.name).tag(String?.some($0.path)) }
      }
      .disabled(form.references.isEmpty)
    } header: {
      Text("Repository")
    } footer: {
      Text(
        form.scaffold == .githubTemplate && !form.githubEnabled
          ? "Without GitHub, the template's files start a local repository with no history."
          : "Project settings are the reference's .argus.json: setup commands, run commands and more.")
    }
  }

  private var instructions: some View {
    Section {
      PlaybookEditor(
        text: $form.instructions,
        placeholder: "What the first agent does in the new project, in Markdown.", minHeight: 200)
    } header: {
      Text("Instructions")
    } footer: {
      Text("Handed to the agent that starts in the new project. "
        + BlueprintText.placeholders.joined(separator: ", ") + " are filled in for each project.")
    }
  }

  private var agent: some View {
    Section {
      RunnerModelRows(runner: $form.runner, model: $form.model, runners: host.runners)
      Picker("Permissions", selection: $form.permissionMode) {
        Text("Default").tag(String?.none)
        ForEach(DefaultPermissionMode.allCases, id: \.self) { Text($0.label).tag(String?.some($0.rawValue)) }
      }
    } header: {
      Text("Agent")
    } footer: {
      Text("Default uses what Settings picks for new agents.")
    }
    .task { await host.loadRunners() }
  }
}

/// The projects a new one borrows from, one row each with a note on what to take.
private struct BlueprintReferencesSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var host
  @Binding var form: BlueprintForm

  var body: some View {
    Section {
      if form.references.isEmpty {
        Text("No references. Add projects the agent should copy structure, tooling or workflows from.")
          .foregroundStyle(.secondary)
      }
      ForEach($form.references) { $reference in
        HStack(alignment: .center, spacing: 10) {
          ProjectBadge(reference.name, key: reference.path, size: 22)
          VStack(alignment: .leading, spacing: 2) {
            Text(reference.name).fontWeight(.medium).help(HostScopedPath.path(reference.path))
            TextField("Note", text: $reference.note, prompt: Text("What to take from it"))
              .labelsHidden()
              .multilineTextAlignment(.leading)
              .textFieldStyle(.plain)
              .font(.scaled(.caption))
              .foregroundStyle(.secondary)
          }
          Spacer(minLength: 0)
          Button {
            form.removeReference(reference.path)
          } label: {
            Image(systemName: "minus.circle")
          }
          .buttonStyle(.argusBorderless)
          .foregroundStyle(.secondary)
          .help("Remove \(reference.name)")
          .accessibilityLabel("Remove \(reference.name)")
        }
      }
    } header: {
      HStack {
        Text("Reference projects")
        Spacer()
        addMenu
      }
    } footer: {
      Text("The agent reads these before it starts.")
    }
  }

  private var addMenu: some View {
    let available = host.projects.filter { project in !form.references.contains { $0.path == project.repoRoot } }
    return Menu("Add") {
      ForEach(available) { project in
        Button(project.name) { form.addReference(project.repoRoot) }
      }
      if !available.isEmpty { Divider() }
      Button("Choose Folder") {
        Task {
          if let path = await model.pickFolder(prompt: "Add Reference") { form.addReference(path) }
        }
      }
    }
    .menuStyle(.button)
    .fixedSize()
    .controlSize(.small)
    .clickable()
  }
}

/// A folder path, typed or picked on the computer it lives on.
struct FolderField: View {
  @Environment(DesktopModel.self) private var model
  let label: String
  @Binding var path: String
  let prompt: String

  var body: some View {
    LabeledContent(label) {
      HStack(spacing: 6) {
        TextField(label, text: $path, prompt: Text("~/Work"))
          .labelsHidden()
          .font(.system(.body, design: .monospaced))
        Button("Choose") {
          Task {
            if let picked = await model.pickFolder(prompt: prompt, start: path) { path = picked }
          }
        }
      }
    }
  }
}
