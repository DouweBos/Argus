import ArgusUI
import SwiftUI

/// `/blueprints/new-project`: name a project, pick its blueprint, and watch the
/// computer check, create the repository, add it to Argus and start the agent.
/// Lands on the new session once it's up.
///
/// Needs control: it creates a repository and starts an agent.
struct NewProjectView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(BlueprintsStore.self) private var store

  @State private var blueprintId: String?
  @State private var request = BlueprintsStore.ProjectRequest()
  @State private var showsOverrides = false
  @State private var starting = false
  /// The project being made; the form gives way to its steps.
  @State private var runId: String?

  init(blueprintId: String?, runId: String? = nil) {
    _blueprintId = State(initialValue: blueprintId)
    _runId = State(initialValue: runId)
  }

  private var blueprint: BlueprintsStore.Blueprint? {
    blueprintId.flatMap(store.blueprint(id:)) ?? store.blueprints.first
  }

  private var canCreate: Bool {
    host.hasControl && blueprint != nil && request.nameProblem == nil && !starting
  }

  var body: some View {
    Group {
      if let runId {
        progress(runId)
      } else {
        form
      }
    }
    .navigationTitle("New Project")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if runId == nil, host.hasControl, blueprint != nil {
        ToolbarItem(placement: .confirmationAction) {
          Button(starting ? "Creating" : "Create") { create() }.disabled(!canCreate)
        }
      }
    }
    .task { if !store.loaded { await store.refresh() } }
    .reportsBlueprintScreen(.newProject)
  }

  // MARK: Form

  private var form: some View {
    List {
      if let error = store.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }
      if let blueprint {
        Section {
          Picker("Blueprint", selection: Binding(get: { blueprint.id }, set: { blueprintId = $0 })) {
            ForEach(store.blueprints, id: \.id) { Text($0.name).tag($0.id) }
          }
        } footer: {
          if !blueprint.summary.isEmpty { Text(blueprint.summary) }
        }
        Section {
          TextField("Name", text: $request.name, prompt: prompt("my-new-app"))
            .font(.scaled(size: 15, design: .monospaced))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          TextField(
            "Description", text: $request.description, prompt: prompt("What it is, in a sentence or two"),
            axis: .vertical
          )
          .lineLimit(3...8)
        } header: {
          Text("Project")
        } footer: {
          if !request.name.isEmpty, let problem = request.nameProblem {
            Text(problem).foregroundStyle(theme.error)
          } else {
            Text("The description goes to the agent with the blueprint's instructions.")
          }
        }
        Section {
          DisclosureGroup("Override for this project", isExpanded: $showsOverrides) {
            overrides(blueprint)
          }
        }
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .disabled(!host.hasControl)
    .loadPhase(store.phase, loading: "Reading blueprints", failedTitle: "Blueprints unavailable") {
      EmptyState(
        icon: BlueprintSymbol.blueprint, title: "No blueprints",
        body: "A new project starts from a blueprint. Write one, or let Claude draft one from your projects."
      ) {
        if host.hasControl {
          Btn(label: "Generate from Projects", icon: Icon.draft, hugs: true) { router.push(.generateBlueprint) }
          Btn(label: "New Blueprint", tone: .secondary, icon: Icon.plus, hugs: true) {
            router.push(.blueprint(id: nil))
          }
        }
      }
    }
  }

  @ViewBuilder
  private func overrides(_ blueprint: BlueprintsStore.Blueprint) -> some View {
    let github = request.githubEnabled ?? blueprint.github.enabled
    LabeledContent("Folder") {
      TextField(
        "Folder", text: Binding(get: { request.parentDir ?? "" }, set: { request.parentDir = $0.nilIfEmpty }),
        prompt: prompt(blueprint.parentDir)
      )
      .font(.scaled(size: 14, design: .monospaced))
      .multilineTextAlignment(.trailing)
      .textInputAutocapitalization(.never)
      .autocorrectionDisabled()
    }
    Toggle(
      "Create a GitHub repository",
      isOn: Binding(
        get: { github },
        set: { request.githubEnabled = $0 == blueprint.github.enabled ? nil : $0 })
    )
    .toggleStyle(.argusSwitch)
    if github {
      LabeledContent("Owner") {
        TextField(
          "Owner", text: Binding(get: { request.owner ?? "" }, set: { request.owner = $0.nilIfEmpty }),
          prompt: prompt(blueprint.github.owner.nilIfEmpty ?? "Your account")
        )
        .multilineTextAlignment(.trailing)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
      }
      Picker("Visibility", selection: visibility(blueprint)) {
        ForEach(BlueprintForm.Visibility.allCases, id: \.self) { Text($0.label).tag($0) }
      }
    }
  }

  private func visibility(_ blueprint: BlueprintsStore.Blueprint) -> Binding<BlueprintForm.Visibility> {
    let fallback = BlueprintForm.Visibility(rawValue: blueprint.github.visibility.rawValue) ?? .private
    return Binding(
      get: { request.visibility ?? fallback },
      set: { request.visibility = $0 == fallback ? nil : $0 })
  }

  // MARK: Progress

  @ViewBuilder
  private func progress(_ runId: String) -> some View {
    Screen {
      if let run = store.run(id: runId) {
        VStack(alignment: .leading, spacing: 4) {
          TitleText(run.projectName)
          MutedText(run.repoRoot).monospaced().lineLimit(1).truncationMode(.middle)
        }
        BlueprintRunSteps(run: run)
        if run.status == .failed {
          Btn(label: "Try Again", tone: .secondary, small: true, icon: Icon.refresh) { self.runId = nil }
        } else if run.status == .done {
          Btn(label: run.sessionId == nil ? "Open Project" : "Open Session", small: true) { open(run) }
        }
      } else {
        Loading(label: "Starting the project")
      }
    }
    .task(id: runId) { await store.watch(runId: runId) }
    .onChange(of: store.run(id: runId)?.status) { _, status in
      guard status == .done, let run = store.run(id: runId) else { return }
      Task {
        await host.refreshProjects()
        open(run)
      }
    }
  }

  private func create() {
    guard let blueprint else { return }
    starting = true
    Task {
      let run = await store.createProject(blueprintId: blueprint.id, request: request)
      starting = false
      if let run { runId = run.id }
    }
  }

  /// Swaps this screen for what it made, so back skips a finished flow.
  private func open(_ run: BlueprintsStore.Run) {
    guard case .newProject = router.frontRoute else { return }
    let route: Route =
      if let sessionId = run.sessionId {
        .session(id: sessionId, label: run.projectName, repoRoot: run.repoRoot)
      } else {
        .project(repoRoot: run.repoRoot, name: run.projectName)
      }
    router.replaceTop(with: route, dropping: 1)
  }

  private func prompt(_ text: String) -> Text {
    Text(text).foregroundStyle(theme.textMuted)
  }
}
