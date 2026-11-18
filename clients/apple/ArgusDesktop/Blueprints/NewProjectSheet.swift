import ArgusCore
import ArgusUI
import SwiftUI

/// A new project from a blueprint: name and describe it, then watch the four
/// steps run. Done opens the project's first session; a failure stays here.
struct NewProjectSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(BlueprintsStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  @State private var blueprintId: String?
  @State private var request = BlueprintsStore.ProjectRequest()
  @State private var runId: String?
  @State private var starting = false
  @State private var showsOverrides = false

  init(blueprintId: String?, runId: String? = nil) {
    _blueprintId = State(initialValue: blueprintId)
    _runId = State(initialValue: runId)
  }

  private var blueprint: ArgusProtocol.Blueprint? {
    blueprintId.flatMap(store.blueprint(id:)) ?? (blueprintId == nil ? store.blueprints.first : nil)
  }

  private var run: ArgusProtocol.BlueprintRun? { runId.flatMap(store.run(id:)) }

  var body: some View {
    VStack(spacing: 0) {
      Form {
        if let run {
          progress(run)
        } else if store.loaded && store.blueprints.isEmpty {
          noBlueprints
        } else {
          details
        }
        if let error = store.error, run == nil { Section { Text(error).foregroundStyle(theme.error) } }
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
      footer
    }
    .frame(width: 560, height: run == nil ? 560 : 340)
    .task { if !store.loaded { await store.refresh() } }
    // Live events keep the run current on this Mac; polling covers a missed one.
    .task(id: runId) { if let runId { await store.watch(runId: runId) } }
    .onChange(of: run?.status) { _, status in
      guard status == .done, let run else { return }
      dismiss()
      BlueprintActions.open(model, run: run)
    }
  }

  // MARK: Before

  @ViewBuilder
  private var details: some View {
    Section {
      Picker("Blueprint", selection: Binding(get: { blueprint?.id }, set: { blueprintId = $0 })) {
        ForEach(store.blueprints, id: \.id) { Text($0.name).tag(String?.some($0.id)) }
      }
      if let summary = blueprint?.summary, !summary.isEmpty {
        Text(summary).font(.scaled(.caption)).foregroundStyle(.secondary)
      }
    }
    Section {
      TextField("Name", text: $request.name, prompt: Text("my-new-app"))
    } footer: {
      if !request.name.isEmpty, let problem = request.nameProblem {
        Text(problem).foregroundStyle(theme.error)
      } else if let blueprint {
        Text("Creates \(location(blueprint)).")
      }
    }
    Section("Description") {
      TextField(
        "Description", text: $request.description,
        prompt: Text("What it is and what the agent should build first."), axis: .vertical
      )
      .labelsHidden()
      .lineLimit(3...8)
    }
    if let blueprint {
      Section {
        DisclosureGroup("Folder and GitHub", isExpanded: $showsOverrides) { overrides(blueprint) }
      }
    }
  }

  @ViewBuilder
  private func overrides(_ blueprint: ArgusProtocol.Blueprint) -> some View {
    FolderField(
      label: "Folder",
      path: Binding(get: { request.parentDir ?? blueprint.parentDir }, set: { request.parentDir = $0 }),
      prompt: "Choose Folder")
    let github = Binding(get: { request.githubEnabled ?? blueprint.github.enabled }, set: { request.githubEnabled = $0 })
    Toggle("Create a GitHub repository", isOn: github)
    if github.wrappedValue {
      TextField(
        "Owner", text: Binding(get: { request.owner ?? blueprint.github.owner }, set: { request.owner = $0 }),
        prompt: Text("Your GitHub account"))
      Picker(
        "Visibility",
        selection: Binding(
          get: {
            request.visibility ?? BlueprintForm.Visibility(rawValue: blueprint.github.visibility.rawValue) ?? .private
          },
          set: { request.visibility = $0 })
      ) {
        ForEach(BlueprintForm.Visibility.allCases, id: \.self) { Text($0.label).tag($0) }
      }
      .pickerStyle(.segmented)
    }
  }

  private func location(_ blueprint: ArgusProtocol.Blueprint) -> String {
    let name = request.name.trimmingCharacters(in: .whitespaces)
    let folder = (request.parentDir ?? blueprint.parentDir) + "/" + (name.isEmpty ? "name" : name)
    guard request.githubEnabled ?? blueprint.github.enabled else { return "\(folder) with a local repository" }
    let visibility = (request.visibility?.rawValue ?? blueprint.github.visibility.rawValue)
    return "\(folder) and a \(visibility) GitHub repository"
  }

  private var noBlueprints: some View {
    Section {
      Text("There are no blueprints yet. Make one first, or let Claude draft one from projects you have.")
        .foregroundStyle(.secondary)
    }
  }

  // MARK: During and after

  private func progress(_ run: ArgusProtocol.BlueprintRun) -> some View {
    Section {
      BlueprintStepList(steps: run.steps)
    } header: {
      Text(run.projectName)
    } footer: {
      switch run.status {
      case .running: Text("The agent opens here once the project is ready.")
      case .failed: Text("Fix what the step reports, then try again.")
      default: EmptyView()
      }
    }
  }

  private var footer: some View {
    HStack {
      if let run, run.status == .failed {
        Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button("Edit and Retry") {
          request.name = run.projectName
          runId = nil
        }.keyboardShortcut(.defaultAction)
      } else if run != nil {
        Spacer()
        Button("Hide") { dismiss() }.keyboardShortcut(.cancelAction)
          .help("The project keeps being made; it shows under the blueprint")
      } else if store.loaded && store.blueprints.isEmpty {
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button("Generate from Projects") { model.navigate(.generateBlueprint) }
        Button("New Blueprint") { model.navigate(.blueprint(id: nil)) }.keyboardShortcut(.defaultAction)
      } else {
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button(starting ? "Creating" : "Create Project") { create() }
          .keyboardShortcut(.defaultAction)
          .disabled(starting || blueprint == nil || request.nameProblem != nil)
      }
    }
    .padding()
  }

  private func create() {
    guard let blueprint else { return }
    starting = true
    Task {
      defer { starting = false }
      if let started = await store.createProject(blueprintId: blueprint.id, request: request) {
        blueprintId = blueprint.id
        runId = started.id
      }
    }
  }
}
